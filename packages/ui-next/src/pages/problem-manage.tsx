/**
 * Problem management pages — config, files, solutions, statistics, import.
 */

import { useState, useRef, useCallback } from 'react';
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
  Pencil,
  Save,
  Settings,
  Flag,
  Send,
  Lightbulb,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AdminPage } from '@/components/admin/admin-page';
import { Pagination } from '@/components/ui/pagination';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap, type GenericUserDoc } from '@/lib/bootstrap';
import { formatRelativeTime, formatDateTime, makeInitials, replaceRouteTokens } from '@/lib/format';
import { cn } from '@/lib/cn';

type R = Record<string, any>;

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? udict[String(uid)] ?? null : null;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readYamlScalar(source: string, key: string) {
  const match = source.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function writeYamlScalar(source: string, key: string, value: string) {
  const cleanValue = value.trim();
  const linePattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, 'm');
  if (!cleanValue) return source.replace(linePattern, '').replace(/\n{3,}/g, '\n\n').trimStart();
  const nextLine = `${key}: ${cleanValue}`;
  if (linePattern.test(source)) return source.replace(linePattern, nextLine);
  const prefix = source.trimEnd();
  return `${prefix}${prefix ? '\n' : ''}${nextLine}\n`;
}

/* ---------- Shared Problem Sidebar ---------- */

function ProblemSidebar({ problemUrl, active }: { problemUrl: string; active: string }) {
  const nav = [
    { key: 'detail', icon: Flag, label: '查看题目', href: problemUrl },
    { key: 'submit', icon: Send, label: '提交', href: `${problemUrl}/submit` },
    { key: 'solution', icon: Lightbulb, label: '题解', href: `${problemUrl}/solution` },
    { key: 'files', icon: FolderOpen, label: '文件', href: `${problemUrl}/files` },
    { key: 'statistics', icon: BarChart3, label: '统计', href: `${problemUrl}/statistics` },
  ];
  const editNav = [
    { key: 'edit', icon: Pencil, label: '编辑', href: `${problemUrl}/edit` },
    { key: 'config', icon: Settings, label: '评测配置', href: `${problemUrl}/config` },
  ];

  return (
    <nav className="space-y-1">
      {nav.map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            active === item.key
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <item.icon className="size-4" />
          {item.label}
        </a>
      ))}
      <div className="my-2 border-t" />
      {editNav.map((item) => (
        <a
          key={item.key}
          href={item.href}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            active === item.key
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <item.icon className="size-4" />
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/* ---------- Problem Config ---------- */

export { ProblemConfigPage } from './problem-config-page-wrapper';


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
  const [renamingFiles, setRenamingFiles] = useState<Record<string, string>>({});
  const [renamingType, setRenamingType] = useState<'testdata' | 'additional_file'>('testdata');
  const [showGenerate, setShowGenerate] = useState(false);
  const testdataFileRef = useRef<HTMLInputElement>(null);
  const additionalFileRef = useRef<HTMLInputElement>(null);

  const toggleFile = (set: Set<string>, setFn: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name); else next.add(name);
    setFn(next);
  };

  const toggleAll = (files: R[], selected: Set<string>, setSelected: (s: Set<string>) => void) => {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.name)));
  };

  const startRename = (selected: Set<string>, type: 'testdata' | 'additional_file') => {
    const mapping: Record<string, string> = {};
    for (const name of selected) mapping[name] = name;
    setRenamingType(type);
    setRenamingFiles(mapping);
  };

  const FileSection = ({
    title,
    files,
    type,
    selected,
    setSelected,
    fileRef,
  }: {
    title: string;
    files: R[];
    type: string;
    selected: Set<string>;
    setSelected: (s: Set<string>) => void;
    fileRef: React.RefObject<HTMLInputElement | null>;
  }) => (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />
          {title} ({files.length})
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {/* Upload */}
          {!reference && (
            <form method="post" encType="multipart/form-data" className="flex items-center">
              <input type="hidden" name="type" value={type} />
              <input ref={fileRef} type="file" name="file" className="hidden" multiple onChange={(e) => {
                if (e.target.files?.length) e.target.form?.submit();
              }} />
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 size-3" />上传
              </Button>
            </form>
          )}
          {selected.size > 0 && (
            <>
              {/* Download */}
              <form method="post">
                <input type="hidden" name="operation" value="get_links" />
                <input type="hidden" name="type" value={type} />
                {Array.from(selected).map((f) => (
                  <input key={f} type="hidden" name="files" value={f} />
                ))}
                <Button type="submit" size="sm" variant="outline">
                  <Download className="mr-1 size-3" />下载 ({selected.size})
                </Button>
              </form>
              {/* Rename */}
              {!reference && (
                <Button size="sm" variant="outline" onClick={() => startRename(selected, type as 'testdata' | 'additional_file')}>
                  <Pencil className="mr-1 size-3" />重命名
                </Button>
              )}
              {/* Delete */}
              {!reference && (
                <form method="post">
                  <input type="hidden" name="operation" value="delete_files" />
                  <input type="hidden" name="type" value={type} />
                  {Array.from(selected).map((f) => (
                    <input key={f} type="hidden" name="files" value={f} />
                  ))}
                  <Button type="submit" size="sm" variant="destructive">
                    <Trash2 className="mr-1 size-3" />删除 ({selected.size})
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {files.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selected.size === files.length && files.length > 0}
                    onChange={() => toggleAll(files, selected, setSelected)}
                   />
                </TableHead>
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-40 text-right">修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.name} className={selected.has(f.name) ? 'bg-muted/50' : ''}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(f.name)}
                      onChange={() => toggleFile(selected, setSelected, f.name)}
                     />
                  </TableCell>
                  <TableCell>
                    <a
                      href={`${problemUrl}/file/${f.name}?type=${type}`}
                      className="font-mono text-sm text-primary hover:underline"
                    >
                      {f.name}
                    </a>
                  </TableCell>
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

  // Rename dialog
  const renameKeys = Object.keys(renamingFiles);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={problemUrl}><ArrowLeft className="size-4" /></a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">题目文件</h1>
          <p className="text-sm text-muted-foreground">{pdoc.title || pid}</p>
        </div>
      </div>

      {/* Rename overlay */}
      {renameKeys.length > 0 && (
        <Card className="mb-6 border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">重命名文件</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="post" className="space-y-3">
              <input type="hidden" name="operation" value="rename_files" />
              <input type="hidden" name="type" value={renamingType} />
              {renameKeys.map((oldName) => (
                <div key={oldName} className="flex items-center gap-3">
                  <input type="hidden" name="files" value={oldName} />
                  <span className="w-40 truncate font-mono text-sm text-muted-foreground">{oldName}</span>
                  <span className="text-muted-foreground">→</span>
                  <Input
                    name="newNames"
                    value={renamingFiles[oldName]}
                    onChange={(e) => setRenamingFiles({ ...renamingFiles, [oldName]: e.target.value })}
                    className="max-w-xs font-mono text-sm"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="submit" size="sm">确认重命名</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setRenamingFiles({})}>取消</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-6">
        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-6">
          {reference && (
            <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="p-4 text-sm">
                <p>此题目引用自其他题目，文件由源题目管理。</p>
              </CardContent>
            </Card>
          )}

          <FileSection title="测试数据" files={testdata} type="testdata" selected={selectedTestdata} setSelected={setSelectedTestdata} fileRef={testdataFileRef} />
          <FileSection title="附加文件" files={additionalFile} type="additional_file" selected={selectedAdditional} setSelected={setSelectedAdditional} fileRef={additionalFileRef} />

          {/* Generate testdata */}
          {!reference && testdata.length > 0 && (
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play className="size-4" />
                  生成测试数据 (Beta)
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={() => setShowGenerate((v) => !v)}>
                  {showGenerate ? '收起' : '展开'}
                </Button>
              </CardHeader>
              {showGenerate && (
                <CardContent>
                  <form method="post" className="space-y-3">
                    <input type="hidden" name="operation" value="generate_testdata" />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">数据生成器</label>
                        <SimpleSelect
                          name="gen"
                          required
                          defaultValue=""
                          placeholder="选择生成器文件…"
                          options={[
                            { value: '', label: '选择生成器文件…' },
                            ...testdata.filter((f) => !f.name.endsWith('.in') && !f.name.endsWith('.out') && !f.name.endsWith('.ans') && f.name !== 'config.yaml').map((f) => ({ value: f.name, label: f.name })),
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">输出测试数据到 stdout 的程序</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">标准程序</label>
                        <SimpleSelect
                          name="std"
                          required
                          defaultValue=""
                          placeholder="选择标程文件…"
                          options={[
                            { value: '', label: '选择标程文件…' },
                            ...testdata.filter((f) => !f.name.endsWith('.in') && !f.name.endsWith('.out') && !f.name.endsWith('.ans') && f.name !== 'config.yaml').map((f) => ({ value: f.name, label: f.name })),
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">输出答案到 stdout 的程序</p>
                      </div>
                    </div>
                    <Button type="submit" size="sm">
                      <RefreshCw className="mr-1 size-3.5" />
                      生成数据
                    </Button>
                  </form>
                </CardContent>
              )}
            </Card>
          )}
        </div>

        {/* Right sidebar */}
        <div className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 space-y-6">
            <ProblemSidebar problemUrl={problemUrl} active="files" />
          </div>
        </div>
      </div>
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
                <MarkdownEditor name="content" value="" minHeight={320} preferredLang={bs.locale} />
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
  const currentLang: string = data.lang || '';
  const langs: Record<string, R> = data.langs || {};
  const types: string[] = data.types || [];
  const udict: Record<string, GenericUserDoc> = bs.udict || data.udict || {};
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  const SORT_LABELS: Record<string, string> = {
    time: '时间',
    memory: '内存',
    length: '代码长度',
  };

  const statQuery = (nextSort = sort, nextDirection = direction, lang = currentLang) => {
    const query = new URLSearchParams();
    if (nextSort) query.set('sort', nextSort);
    query.set('direction', String(nextDirection));
    if (lang) query.set('lang', lang);
    return `?${query.toString()}`;
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

      <Card>
        <CardContent className="p-4">
          <form method="get" className="grid gap-3 sm:grid-cols-[1fr_140px_180px_auto] sm:items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">排序字段</label>
              <SimpleSelect
                name="sort"
                defaultValue={sort}
                options={types.map((type) => ({ value: type, label: SORT_LABELS[type] || type }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">方向</label>
              <SimpleSelect
                name="direction"
                defaultValue={String(direction)}
                options={[
                  { value: '1', label: '升序' },
                  { value: '-1', label: '降序' },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">语言</label>
              <SimpleSelect
                name="lang"
                defaultValue={currentLang}
                options={[
                  { value: '', label: '全部语言' },
                  ...Object.entries(langs).map(([key, lang]) => ({
                    value: key,
                    label: String((lang as any).display || key),
                  })),
                ]}
              />
            </div>
            <Button type="submit" size="sm">筛选</Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <Button
            key={t}
            asChild
            variant={sort === t ? 'default' : 'outline'}
            size="sm"
          >
            <a href={statQuery(t, sort === t ? -direction : 1)}>
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
          <Pagination current={page} total={pcount} baseUrl={statQuery()} />
        </div>
      )}
    </motion.div>
  );
}

/* ---------- Problem Import ---------- */

export function ProblemImportPage() {
  return (
    <AdminPage
      bypassPrivGate
      title="导入题目"
      description="从 Hydro 格式压缩包批量导入题目"
    >
      <Card>
        <CardContent className="p-6">
          <form method="post" encType="multipart/form-data" className="grid gap-4 sm:max-w-xl">
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
                <Checkbox name="hidden" value="true"  />
                导入后隐藏
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="keepUser" value="true"  />
                保留用户信息
              </label>
            </div>
            <div className="flex justify-end">
              <Button type="submit">
                <Import className="mr-1 size-4" />导入
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
