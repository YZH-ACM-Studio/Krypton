import { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Copy, Eye, EyeOff, Lock, MinusCircle, Plus, Search, Trash2, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Checkbox } from '@/components/ui/checkbox';
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

function buildUrlWithQuery(baseUrl: string, params: Record<string, unknown>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || value === false) return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

function SelectedPids({ pids }: { pids: string[] }) {
  return (
    <>
      {pids.map((pid) => (
        <input key={pid} type="hidden" name="pids" value={pid} />
      ))}
    </>
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
  const query = data.qs || data.query || data.q || '';
  const sort = data.sort || 'default';
  const [selected, setSelected] = useState<string[]>([]);
  const visibleIds = pdocs.map((p) => String(p.docId || '')).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const problemsBaseUrl = buildUrlWithQuery(bs.urls.problems, { q: query, sort: sort === 'default' ? '' : sort });

  const toggleVisible = (checked: boolean) => {
    setSelected((current) => {
      if (!checked) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((current) => {
      if (checked) return Array.from(new Set([...current, id]));
      return current.filter((item) => item !== id);
    });
  };

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold">题库</h1>
          <p className="text-sm text-muted-foreground">共 {pcount} 道题目</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button asChild variant="outline" size="sm">
            <a href="/problem/import/hydro">
              <Upload className="size-4" />
              导入
            </a>
          </Button>
          <Button asChild size="sm">
            <a href="/problem/create">
              <Plus className="size-4" />
              新建题目
            </a>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end" method="get" action={bs.urls.problems}>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">搜索</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input name="q" defaultValue={query} placeholder="题目、标签、难度…" className="pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">排序</label>
              <SimpleSelect
                name="sort"
                defaultValue={sort}
                className="h-9"
                options={[
                  { value: 'default', label: '默认顺序' },
                  { value: 'recent', label: '最近添加' },
                ]}
              />
            </div>
            <Button type="submit" size="sm">搜索</Button>
          </form>
        </CardContent>
      </Card>

      {selected.length ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">已选择 {selected.length} 道题目</p>
                <p className="text-xs text-muted-foreground">批量隐藏、取消隐藏、删除或复制到其他域</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                清空选择
              </Button>
            </div>
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                <form method="post">
                  <input type="hidden" name="operation" value="hide" />
                  <SelectedPids pids={selected} />
                  <Button type="submit" variant="outline" size="sm">
                    <EyeOff className="size-4" />
                    隐藏
                  </Button>
                </form>
                <form method="post">
                  <input type="hidden" name="operation" value="unhide" />
                  <SelectedPids pids={selected} />
                  <Button type="submit" variant="outline" size="sm">
                    <Eye className="size-4" />
                    取消隐藏
                  </Button>
                </form>
                <form method="post" onSubmit={(event) => {
                  if (!window.confirm(`确定删除选中的 ${selected.length} 道题目？`)) event.preventDefault();
                }}>
                  <input type="hidden" name="operation" value="delete" />
                  <SelectedPids pids={selected} />
                  <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                    <Trash2 className="size-4" />
                    删除
                  </Button>
                </form>
              </div>
              <form method="post" className="grid gap-2 sm:grid-cols-[180px_auto_auto] sm:items-center">
                <input type="hidden" name="operation" value="copy" />
                <input type="hidden" name="redirect" value="true" />
                <SelectedPids pids={selected} />
                <Input name="target" placeholder="目标域 ID" className="h-8" />
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox size="sm" name="hidden" value="true"  />
                  复制后隐藏
                </label>
                <Button type="submit" variant="outline" size="sm">
                  <Copy className="size-4" />
                  复制
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                {bs.user.signedIn ? (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      onChange={(event) => toggleVisible(event.currentTarget.checked)}
                      aria-label="选择当前页"
                     />
                  </TableHead>
                ) : null}
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
                  <TableCell colSpan={bs.user.signedIn ? 6 : 5} className="py-8 text-center text-sm text-muted-foreground">
                    没有找到题目
                  </TableCell>
                </TableRow>
              ) : (
                pdocs.map((p) => {
                  const ps = psdict[String(p.docId)] || psdict[String(p._id)];
                  const selectableId = String(p.docId || '');
                  const nSubmit = p.nSubmit || 0;
                  const nAccept = p.nAccept || 0;
                  const rate = nSubmit > 0 ? Math.round((nAccept / nSubmit) * 100) : 0;
                  return (
                    <TableRow key={String(p.docId || p._id)}>
                      {bs.user.signedIn ? (
                        <TableCell>
                          <Checkbox
                            checked={selected.includes(selectableId)}
                            onChange={(event) => toggleOne(selectableId, event.currentTarget.checked)}
                            aria-label={`选择题目 ${p.pid || p.docId}`}
                           />
                        </TableCell>
                      ) : null}
                      <TableCell>{statusIcon(ps?.status)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.pid || p.docId}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <a
                            href={replaceRouteTokens(bs.urls.problemDetail, { PID: String(p.pid || p.docId) })}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {p.title || '未命名'}
                          </a>
                          {p.hidden ? (
                            <Badge
                              variant="outline"
                              className="gap-0.5 border-amber-500/40 bg-amber-50 px-1 py-0 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              title="该题目已隐藏，只有有权限的用户可见"
                            >
                              <EyeOff className="size-2.5" />
                              隐藏
                            </Badge>
                          ) : null}
                          {p.lockHidden ? (
                            <Badge
                              variant="outline"
                              className="gap-0.5 border-rose-500/40 bg-rose-50 px-1 py-0 text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                              title="该题目设为「锁定隐藏」，比赛结束后不会自动公开"
                            >
                              <Lock className="size-2.5" />
                              锁定
                            </Badge>
                          ) : null}
                        </div>
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

      <Pagination current={page} total={ppcount} baseUrl={problemsBaseUrl} />
    </motion.div>
  );
}
