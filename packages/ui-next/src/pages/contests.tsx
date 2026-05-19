import { motion } from 'motion/react';
import { Download, Search, Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens, toDate } from '@/lib/format';

type R = Record<string, any>;
type ScoreboardCell = {
  type?: string;
  value?: string | number;
  raw?: any;
  score?: number;
  hover?: string;
};

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
  const groups: string[] = data.groups || [];
  const rules: Record<string, string> = data.rules || {};
  const currentGroup = data.group || '';
  const currentRule = data.rule || '';
  const currentQuery = data.q || '';
  const pageBase = (() => {
    const query = new URLSearchParams();
    if (currentQuery) query.set('q', currentQuery);
    if (currentGroup) query.set('group', currentGroup);
    if (currentRule) query.set('rule', currentRule);
    const suffix = query.toString();
    return suffix ? `${bs.urls.contests}?${suffix}` : bs.urls.contests;
  })();

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
        <CardContent className="p-4">
          <form method="get" className="grid gap-3 sm:grid-cols-[1fr_180px_180px_auto] sm:items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">搜索</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={currentQuery}
                  className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
                  placeholder="比赛名称"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">用户组</label>
              <select name="group" defaultValue={currentGroup} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">全部</option>
                {groups.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">赛制</label>
              <select name="rule" defaultValue={currentRule} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">全部</option>
                {Object.entries(rules).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <Button type="submit" size="sm">筛选</Button>
          </form>
        </CardContent>
      </Card>

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

      <Pagination current={page} total={tpcount} baseUrl={pageBase} />
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
            <MarkdownView content={tdoc.content} className="prose prose-sm dark:prose-invert max-w-none" />
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
  const rows: ScoreboardCell[][] = Array.isArray(data.rows) ? data.rows : [];
  const header = rows[0] || [];
  const body = rows.slice(1);
  const pdict: Record<string, R> = data.pdict || {};
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const isHomework = tdoc.rule === 'homework';
  const detailUrl = replaceRouteTokens(isHomework ? bs.urls.homeworkDetail : bs.urls.contestDetail, {
    TID: String(tdoc.docId),
  });
  const scoreboardUrl = `${detailUrl}/scoreboard`;
  const availableViews = Array.isArray(data.availableViews) ? data.availableViews : [];
  const extraViews = availableViews.filter(([id]: [string]) => !['html', 'csv', 'default', 'ghost'].includes(id));

  function cellText(cell: ScoreboardCell) {
    return cell.value == null ? '—' : String(cell.value);
  }

  function scoreClass(cell: ScoreboardCell) {
    const score = Number(cell.score ?? cell.value);
    if (!Number.isFinite(score)) return 'text-foreground';
    if (score >= 100) return 'text-green-600 dark:text-green-400';
    if (score > 0) return 'text-amber-600 dark:text-amber-400';
    return 'text-muted-foreground';
  }

  function renderRecordCell(cell: ScoreboardCell) {
    const content = (
      <span className={`whitespace-pre-line font-semibold ${scoreClass(cell)}`} title={cell.hover || undefined}>
        {cellText(cell)}
      </span>
    );
    if (!cell.raw) return content;
    return (
      <a href={replaceRouteTokens(bs.urls.recordDetail, { RID: String(cell.raw) })} className="hover:underline">
        {content}
      </a>
    );
  }

  function renderHeaderCell(cell: ScoreboardCell, index: number) {
    if (cell.type === 'problem' && cell.raw) {
      const problem = pdict[String(cell.raw)] || {};
      return (
        <a
          href={`${detailUrl}/p/${cell.raw}`}
          className="block text-center hover:text-primary hover:underline"
          title={problem.title || cell.hover || undefined}
        >
          <span>{cellText(cell)}</span>
          <span className="block text-[10px] text-muted-foreground">
            {problem.nAccept || 0}/{problem.nSubmit || 0}
          </span>
        </a>
      );
    }
    return <span className={index === 0 ? 'font-mono' : 'whitespace-pre-line'}>{cellText(cell)}</span>;
  }

  function renderBodyCell(cell: ScoreboardCell) {
    if (cell.type === 'rank') {
      return (
        <span className="font-mono text-sm text-muted-foreground">
          {cell.value === '0' || cell.value === 0 ? '*' : cellText(cell)}
        </span>
      );
    }
    if (cell.type === 'user') {
      const user = udict[String(cell.raw)] || null;
      const name = user?.uname || cellText(cell);
      return cell.raw ? (
        <a
          href={replaceRouteTokens(bs.urls.userDetail, { UID: String(cell.raw) })}
          className="font-medium hover:text-primary hover:underline"
        >
          {name}
        </a>
      ) : <span className="font-medium">{name}</span>;
    }
    if (cell.type === 'record') return renderRecordCell(cell);
    if (cell.type === 'records' && Array.isArray(cell.raw)) {
      return (
        <span className="space-x-1">
          {cell.raw.map((record: ScoreboardCell, index: number) => (
            <span key={`${record.raw || record.value || index}`}>
              {index > 0 ? <span className="text-muted-foreground">/</span> : null}
              {record.raw ? renderRecordCell(record) : <span className="whitespace-pre-line">{cellText(record)}</span>}
            </span>
          ))}
        </span>
      );
    }
    if (cell.type === 'total_score' || cell.type === 'solved' || cell.type === 'time') {
      return (
        <span className={`whitespace-pre-line font-medium tabular-nums ${cell.type === 'total_score' ? scoreClass(cell) : ''}`} title={cell.hover || undefined}>
          {cellText(cell)}
        </span>
      );
    }
    return <span className="whitespace-pre-line" title={cell.hover || undefined}>{cellText(cell)}</span>;
  }

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <a href={isHomework ? bs.urls.homework : bs.urls.contests} className="hover:text-primary">
              {isHomework ? '作业' : '比赛'}
            </a>
            <ChevronRight className="size-3" />
            <a href={detailUrl} className="hover:text-primary">
              {tdoc.title || (isHomework ? '作业' : '比赛')}
            </a>
            <ChevronRight className="size-3" />
          </div>
          <h1 className="mt-1 text-xl font-semibold">排行榜</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {['html', 'csv', 'ghost'].map((view) => (
            <Button key={view} asChild variant="outline" size="sm">
              <a href={`${scoreboardUrl}/${view}`} target="_blank" rel="noreferrer">
                <Download className="size-4" />
                {view.toUpperCase()}
              </a>
            </Button>
          ))}
          {extraViews.map(([id, name]: [string, string]) => (
            <Button key={id} asChild variant="outline" size="sm">
              <a href={`${scoreboardUrl}/${id}`} target="_blank" rel="noreferrer">
                {name || id}
              </a>
            </Button>
          ))}
        </div>
      </div>

      {tdoc.lockAt && !tdoc.unlocked ? (
        <Card className="border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-200">
            排行榜已封榜，封榜后的提交可能会暂时显示为待定。
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {header.length > 0 ? (
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  {header.map((cell, index) => (
                    <TableHead
                      key={`${cell.type || 'col'}-${index}`}
                      className={cell.type === 'problem' || cell.type === 'record' || cell.type === 'records' ? 'min-w-20 text-center' : 'min-w-24'}
                    >
                      {renderHeaderCell(cell, index)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {body.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {header.map((head, columnIndex) => {
                      const cell = row[columnIndex] || {};
                      return (
                        <TableCell
                          key={`${rowIndex}-${columnIndex}`}
                          className={head.type === 'problem' || cell.type === 'record' || cell.type === 'records' ? 'text-center' : ''}
                        >
                          {renderBodyCell(cell)}
                        </TableCell>
                      );
                    })}
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
