/**
 * Problem management pages — config, files, solutions, statistics, import.
 */

import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  FileCode,
  FileText,
  FolderOpen,
  Import,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  BarChart3,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownView } from '@/components/markdown-renderer';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, formatDateTime, makeInitials, replaceRouteTokens } from '@/lib/format';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------- Problem Config ---------- */

export function ProblemConfigPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const testdata: R[] = data.testdata || [];
  const config: string = data.config || '';
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={problemUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">题目配置</h1>
          <p className="text-sm text-muted-foreground">{pdoc.title || pid}</p>
        </div>
      </div>

      {/* Config YAML */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCode className="size-4" />
            config.yaml
          </CardTitle>
        </CardHeader>
        <CardContent>
          {config ? (
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-sm font-mono whitespace-pre-wrap">
              {config}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">未找到 config.yaml 文件</p>
          )}
        </CardContent>
      </Card>

      {/* Testdata files */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="size-4" />
            测试数据 ({testdata.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {testdata.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-28 text-right">大小</TableHead>
                  <TableHead className="w-40 text-right">修改时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testdata.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-sm">{f.name}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">暂无测试数据</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ---------- Problem Files ---------- */

export function ProblemFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const testdata: R[] = data.testdata || [];
  const additionalFile: R[] = data.additional_file || [];
  const reference: R | null = data.reference || null;
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  const [selectedTestdata, setSelectedTestdata] = useState<Set<string>>(new Set());
  const [selectedAdditional, setSelectedAdditional] = useState<Set<string>>(new Set());

  const toggleFile = (set: Set<string>, setFn: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name); else next.add(name);
    setFn(next);
  };

  const FileSection = ({
    title,
    files,
    type,
    selected,
    setSelected,
  }: {
    title: string;
    files: R[];
    type: string;
    selected: Set<string>;
    setSelected: (s: Set<string>) => void;
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />
          {title} ({files.length})
        </CardTitle>
        <div className="flex items-center gap-2">
          <form method="post" encType="multipart/form-data" className="flex items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
              <Upload className="mr-1 size-3" />上传
            </Button>
          </form>
          {selected.size > 0 && (
            <form method="post">
              <input type="hidden" name="type" value={type} />
              {Array.from(selected).map((f) => (
                <input key={f} type="hidden" name="files" value={f} />
              ))}
              <Button type="submit" name="operation" value="delete_files" size="sm" variant="destructive">
                <Trash2 className="mr-1 size-3" />删除 ({selected.size})
              </Button>
            </form>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {files.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-40 text-right">修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.name}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(f.name)}
                      onChange={() => toggleFile(selected, setSelected, f.name)}
                      className="size-4 rounded border"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{f.name}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{formatSize(f.size || 0)}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">暂无文件</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={problemUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">题目文件</h1>
          <p className="text-sm text-muted-foreground">{pdoc.title || pid}</p>
        </div>
      </div>

      {reference && (
        <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm">
            <p>此题目引用自其他题目，文件由源题目管理。</p>
          </CardContent>
        </Card>
      )}

      <FileSection title="测试数据" files={testdata} type="testdata" selected={selectedTestdata} setSelected={setSelectedTestdata} />
      <FileSection title="附加文件" files={additionalFile} type="additional_file" selected={selectedAdditional} setSelected={setSelectedAdditional} />
    </motion.div>
  );
}

/* ---------- Problem Solution ---------- */

export function ProblemSolutionPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const psdocs: R[] = data.psdocs || [];
  const page = Number(data.page) || 1;
  const pcount = Number(data.pcount) || 1;
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  const [showForm, setShowForm] = useState(false);

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <a href={problemUrl}><ArrowLeft className="size-4" /></a>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">题解</h1>
            <p className="text-sm text-muted-foreground">{pdoc.title || pid}</p>
          </div>
        </div>
        <Button onClick={() => setShowForm((p) => !p)}>
          <MessageSquare className="mr-1 size-4" />发布题解
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4">
            <form method="post" className="space-y-3">
              <input type="hidden" name="operation" value="submit" />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">题解内容 (Markdown)</label>
                <textarea
                  name="content"
                  rows={8}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                  placeholder="撰写你的题解..."
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" type="button" onClick={() => setShowForm(false)}>取消</Button>
                <Button type="submit">提交</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {psdocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无题解</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {psdocs.map((ps) => {
            const owner = getUser(udict, ps.owner);
            return (
              <Card key={String(ps._id)}>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{owner?.uname || `UID ${ps.owner}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {ps.updateAt ? formatRelativeTime(ps.updateAt, bs.locale) : ''}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-3">
                      <form method="post" className="inline">
                        <input type="hidden" name="operation" value="upvote" />
                        <input type="hidden" name="psid" value={String(ps._id)} />
                        <button type="submit" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                          <ThumbsUp className="size-3.5" />{ps.vote || 0}
                        </button>
                      </form>
                      <form method="post" className="inline">
                        <input type="hidden" name="operation" value="downvote" />
                        <input type="hidden" name="psid" value={String(ps._id)} />
                        <button type="submit" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive">
                          <ThumbsDown className="size-3.5" />
                        </button>
                      </form>
                    </div>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <MarkdownView content={ps.content || ''} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pcount > 1 && (
        <div className="flex justify-center">
          <Pagination
            current={page}
            total={pcount}
            baseUrl="?"
          />
        </div>
      )}
    </motion.div>
  );
}

/* ---------- Problem Statistics ---------- */

export function ProblemStatisticsPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};
  const rsdocs: R[] = data.rsdocs || [];
  const page = Number(data.page) || 1;
  const pcount = Number(data.pcount) || 1;
  const sort: string = data.sort || 'time';
  const direction: number = Number(data.direction) || 1;
  const types: string[] = data.types || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  const SORT_LABELS: Record<string, string> = {
    time: '时间',
    memory: '内存',
    length: '代码长度',
  };

  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={problemUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">提交统计</h1>
          <p className="text-sm text-muted-foreground">{pdoc.title || pid}</p>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <Button
            key={t}
            asChild
            variant={sort === t ? 'default' : 'outline'}
            size="sm"
          >
            <a href={`?sort=${t}&direction=${sort === t ? -direction : 1}`}>
              {SORT_LABELS[t] || t}
              {sort === t && (direction === 1 ? <ChevronUp className="ml-1 size-3" /> : <ChevronDown className="ml-1 size-3" />)}
            </a>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rsdocs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead className="w-24 text-right">时间</TableHead>
                  <TableHead className="w-24 text-right">内存</TableHead>
                  <TableHead className="w-24 text-right">代码长度</TableHead>
                  <TableHead className="w-20 text-right">语言</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rsdocs.map((r) => {
                  const u = getUser(udict, r.uid);
                  return (
                    <TableRow key={String(r._id)}>
                      <TableCell>
                        <a href={replaceRouteTokens(bs.urls.userDetail, { UID: String(r.uid) })} className="text-sm text-primary hover:underline">
                          {u?.uname || `UID ${r.uid}`}
                        </a>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.time != null ? `${r.time}ms` : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.memory != null ? `${(r.memory / 1024).toFixed(0)}KB` : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.length != null ? `${r.length}B` : '-'}</TableCell>
                      <TableCell className="text-right"><Badge variant="outline" className="text-xs">{r.lang || '-'}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">暂无统计数据</p>
          )}
        </CardContent>
      </Card>

      {pcount > 1 && (
        <div className="flex justify-center">
          <Pagination current={page} total={pcount} baseUrl={`?sort=${sort}&direction=${direction}`} />
        </div>
      )}
    </motion.div>
  );
}

/* ---------- Problem Import ---------- */

export function ProblemImportPage() {
  const bs = useBootstrap();

  return (
    <motion.div
      className="mx-auto max-w-lg space-y-6 pt-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={bs.urls.problems}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">导入题目</h1>
          <p className="text-sm text-muted-foreground">从 Hydro 格式压缩包导入</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" encType="multipart/form-data" className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">题目文件</label>
              <input type="file" name="file" accept=".zip,.tar,.gz" required className="w-full text-sm" />
              <p className="text-xs text-muted-foreground">支持 .zip 格式的 Hydro 题目包</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="prefix" className="text-sm font-medium">题号前缀 (可选)</label>
              <Input id="prefix" name="preferredPrefix" placeholder="例如 A, P, CF" pattern="[a-zA-Z]*" />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="hidden" value="true" className="size-4 rounded border" />
                导入后隐藏
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="keepUser" value="true" className="size-4 rounded border" />
                保留用户信息
              </label>
            </div>
            <Button type="submit" className="w-full">
              <Import className="mr-1 size-4" />导入
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
