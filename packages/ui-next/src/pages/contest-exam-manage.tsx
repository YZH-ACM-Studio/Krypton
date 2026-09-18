/**
 * Exam /contest/:tid/management workspace and shared exam chrome.
 * ACM stays on ContestManagePage / ContestManagementChrome.
 */
import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ClipboardCheck,
  Download,
  ExternalLink,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  Printer,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { isSystemAdmin } from '@/lib/perms';
import { ContestExamScoreBatch, type ExamScorePdictRow } from './contest-exam-score-batch';

export type ExamManageSection = 'overview' | 'edit' | 'users' | 'clarification' | 'balloon' | 'print';

export interface ExamManageTdoc {
  docId?: string;
  _id?: string;
  title?: string;
  rule?: string;
  owner?: number;
  allowPrint?: boolean;
}

interface ExamManageFile {
  name: string;
  size?: number;
}

interface ExamManageData {
  tdoc: ExamManageTdoc & {
    pids: number[];
    score?: Record<string, number>;
  };
  files: ExamManageFile[];
  privateFiles: ExamManageFile[];
  pdict: Record<string, ExamScorePdictRow>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function examContestId(tdoc: ExamManageTdoc) {
  return String(tdoc.docId || tdoc._id || '');
}

function examContestUrl(detailTemplate: string, tdoc: ExamManageTdoc) {
  const tid = examContestId(tdoc);
  return tid ? replaceRouteTokens(detailTemplate, { TID: tid }) : '';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function readPids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((pid): pid is number => typeof pid === 'number' && Number.isInteger(pid));
}

function readFiles(value: unknown): ExamManageFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((file) => {
    if (!isRecord(file) || typeof file.name !== 'string' || !file.name) return [];
    const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : undefined;
    return [{ name: file.name, ...(size === undefined ? {} : { size }) }];
  });
}

function readPdict(value: unknown): Record<string, ExamScorePdictRow> {
  if (!isRecord(value)) return {};
  const out: Record<string, ExamScorePdictRow> = {};
  for (const [key, row] of Object.entries(value)) {
    if (!isRecord(row)) continue;
    out[key] = { problemKind: row.problemKind, title: row.title, pid: row.pid };
  }
  return out;
}

function readScoreMap(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, score] of Object.entries(value)) {
    if (typeof score === 'number' && Number.isInteger(score) && score >= 1) out[key] = score;
  }
  return Object.keys(out).length ? out : undefined;
}

function readExamManageData(raw: unknown): ExamManageData {
  const page = isRecord(raw) ? raw : {};
  const tdocRaw = isRecord(page.tdoc) ? page.tdoc : {};
  const pids = readPids(tdocRaw.pids);
  return {
    tdoc: {
      docId: tdocRaw.docId == null ? undefined : String(tdocRaw.docId),
      _id: tdocRaw._id == null ? undefined : String(tdocRaw._id),
      title: typeof tdocRaw.title === 'string' && tdocRaw.title ? tdocRaw.title : '考试',
      rule: typeof tdocRaw.rule === 'string' ? tdocRaw.rule : 'exam',
      owner: typeof tdocRaw.owner === 'number' ? tdocRaw.owner : undefined,
      allowPrint: tdocRaw.allowPrint === true,
      pids,
      score: readScoreMap(tdocRaw.score),
    },
    files: readFiles(page.files),
    privateFiles: readFiles(page.privateFiles),
    pdict: readPdict(page.pdict),
  };
}

type ExamNavKey = ExamManageSection | 'scoreboard' | 'records' | 'code' | 'grading';

interface ExamNavItem {
  key: ExamNavKey;
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  show?: boolean;
}

function examManagementItems(tdoc: ExamManageTdoc, contestUrl: string, canGradeSubjective: boolean): ExamNavItem[] {
  const tid = examContestId(tdoc);
  const items: ExamNavItem[] = [
    { key: 'overview', label: '概览', href: `${contestUrl}/management`, icon: LayoutDashboard },
    { key: 'edit', label: '编辑考试', href: `${contestUrl}/edit`, icon: Settings },
    { key: 'users', label: '考生名单', href: `${contestUrl}/user`, icon: Users },
    { key: 'clarification', label: '答疑', href: `${contestUrl}/clarification`, icon: MessageSquare },
    {
      key: 'grading',
      label: '主观题阅卷',
      href: `/manage/grading/${encodeURIComponent(tid)}`,
      icon: ClipboardCheck,
      show: canGradeSubjective,
    },
    { key: 'print', label: '打印服务', href: `${contestUrl}/print`, icon: Printer, show: !!tdoc.allowPrint },
    { key: 'scoreboard', label: '排行榜', href: `${contestUrl}/scoreboard`, icon: Trophy },
    { key: 'records', label: '全部提交', href: `/record?tid=${encodeURIComponent(tid)}`, icon: Send },
    { key: 'code', label: '导出代码', href: `${contestUrl}/code`, icon: Download },
  ];
  return items.filter((item) => item.show !== false);
}

export function ExamManagementChrome({
  tdoc,
  active,
  children,
}: {
  tdoc: ExamManageTdoc;
  active: ExamManageSection;
  children: ReactNode;
}) {
  const bs = useBootstrap();
  const tid = examContestId(tdoc);
  if (!tid) return <>{children}</>;
  const contestUrl = examContestUrl(bs.urls.contestDetail, tdoc);
  const canGradeSubjective = Number(tdoc.owner) === bs.user.id || isSystemAdmin(bs.user.priv);
  const items = examManagementItems(tdoc, contestUrl, canGradeSubjective);
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="rounded-xl border bg-card p-3">
          <a href={contestUrl} className="group block rounded-lg px-2 py-2 hover:bg-accent/40">
            <p className="line-clamp-2 text-sm font-medium group-hover:text-primary">{tdoc.title || '考试'}</p>
            <p className="mt-1 text-xs text-muted-foreground">返回考试详情</p>
          </a>
          <div className="my-2 h-px bg-border" />
          <nav className="space-y-1" aria-label="考试管理">
            {items.map((item) => {
              const Icon = item.icon;
              const current = item.key === active;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    current ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {!['overview', 'edit', 'users', 'clarification', 'print'].includes(String(item.key)) ? (
                    <ExternalLink className="size-3 opacity-60" />
                  ) : null}
                </a>
              );
            })}
          </nav>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  );
}

export function ExamContestManagePage({ seat }: { seat?: ReactNode }) {
  const bs = useBootstrap();
  const data = readExamManageData(bs.page.data);
  const { tdoc } = data;
  const contestUrl = examContestUrl(bs.urls.contestDetail, tdoc);
  const [selectedPublic, setSelectedPublic] = useState<Set<string>>(new Set());
  const [selectedPrivate, setSelectedPrivate] = useState<Set<string>>(new Set());

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl || bs.urls.contests} aria-label="返回考试详情">
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">考试管理</h1>
            <Badge variant="outline">考试</Badge>
          </div>
          <p className="truncate text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
      </div>

      <ExamManagementChrome tdoc={tdoc} active="overview">
        <div className="space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            机房座位、卷面分值和考生材料。排行、全部提交和代码从侧栏进入。
          </p>
          {seat}
          <ContestExamScoreBatch pids={tdoc.pids} pdict={data.pdict} scores={tdoc.score} />
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">考试材料</h2>
              <p className="mt-1 text-sm text-muted-foreground">公开附件考生可见。私有材料只给管理员。</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ExamFileCard
                title="公开文件"
                description="考生说明、公式或开考须知。"
                icon={FolderOpen}
                fileList={data.files}
                type="public"
                contestUrl={contestUrl}
                selected={selectedPublic}
                setSelected={setSelectedPublic}
              />
              <ExamFileCard
                title="私有材料"
                description="仅管理员可见，不会发给考生。"
                icon={ShieldCheck}
                fileList={data.privateFiles}
                type="private"
                contestUrl={contestUrl}
                selected={selectedPrivate}
                setSelected={setSelectedPrivate}
              />
            </div>
          </div>
        </div>
      </ExamManagementChrome>
    </motion.div>
  );
}

function ExamFileCard({
  title,
  description,
  icon: Icon,
  fileList,
  type,
  contestUrl,
  selected,
  setSelected,
}: {
  title: string;
  description: string;
  icon: typeof FolderOpen;
  fileList: ExamManageFile[];
  type: 'public' | 'private';
  contestUrl: string;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
}) {
  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="size-4" />
            {title}
            <span className="font-normal text-muted-foreground">({fileList.length})</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <form method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="file" name="file" className="text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="outline">
              <Upload className="mr-1 size-3" />
              上传
            </Button>
          </form>
          {selected.size > 0 ? (
            <form
              method="post"
              onSubmit={(event) => {
                void confirmFormSubmit(event, `确认删除选中的 ${selected.size} 个文件吗？`, { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete_files" />
              <input type="hidden" name="type" value={type} />
              {Array.from(selected).map((name) => (
                <input key={name} type="hidden" name="files" value={name} />
              ))}
              <Button type="submit" size="sm" variant="destructive">
                <Trash2 className="mr-1 size-3" />
                删除 ({selected.size})
              </Button>
            </form>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {fileList.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={selected.size === fileList.length && fileList.length > 0}
                    onChange={() => setSelected(selected.size === fileList.length ? new Set() : new Set(fileList.map((file) => file.name)))}
                    aria-label={`全选${title}`}
                  />
                </TableHead>
                <TableHead>文件名</TableHead>
                <TableHead className="w-28 text-right">大小</TableHead>
                <TableHead className="w-28 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileList.map((file) => (
                <TableRow key={file.name}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(file.name)}
                      onChange={() => toggle(file.name)}
                      aria-label={`选择 ${file.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{file.name}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{formatSize(file.size || 0)}</TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-center gap-1">
                      <Button asChild variant="ghost" size="icon" className="size-7">
                        <a href={`${contestUrl}/file/${type}/${encodeURIComponent(file.name)}`} aria-label={`下载 ${file.name}`}>
                          <Download className="size-3" />
                        </a>
                      </Button>
                      <form method="post" className="inline">
                        <input type="hidden" name="files" value={file.name} />
                        <input type="hidden" name="type" value={type} />
                        <Button type="submit" name="operation" value="delete_files" variant="ghost" size="icon" className="size-7">
                          <Trash2 className="size-3 text-destructive" />
                        </Button>
                      </form>
                    </div>
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
}
