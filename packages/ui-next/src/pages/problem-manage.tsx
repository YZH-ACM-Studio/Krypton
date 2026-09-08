/**
 * Problem management pages — config, files, solutions, statistics, import.
 */

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Import,
  MessageSquare,
  Pencil,
  Play,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, useCallback, useState } from 'react';
import { AdminPage } from '@/components/admin/admin-page';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { ProblemEditorWorkspace } from '@/components/problem-editor-workspace';
import { ProblemTestdataFileDialog } from '@/components/problem-testdata-file-dialog';
import {
  type ProblemDataWriteGuardState,
  type ProblemDataWriteOperation,
  prepareProblemDataWrite,
  useProblemDataWriteGuard,
} from '@/components/problem-data-write-guard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileUploader } from '@/components/uploader';
import { type GenericUserDoc, useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime, makeInitials, replaceRouteTokens } from '@/lib/format';
import { downloadProblemFiles } from '@/lib/problem-package';

type ProblemFileType = 'testdata' | 'additional_file';

interface ProblemManageDocument {
  docId?: string | number;
  pid?: string | number;
  title?: string;
}

interface ProblemManageCapabilities {
  canEditContent?: boolean;
  canEditData?: boolean;
  canEditTags?: boolean;
  canSubmitProblem?: boolean;
  canManageCollaborators?: boolean;
  canManageContributions?: boolean;
  canPublish?: boolean;
}

interface ProblemManagedFile {
  name: string;
  size?: number;
  lastModified?: unknown;
}

interface ProblemSolutionDocument {
  _id?: string | number;
  docId?: string | number;
  owner?: string | number;
  updateAt?: unknown;
  vote?: number;
  content?: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

interface ProblemStatisticRecord {
  _id?: string | number;
  uid?: string | number;
  time?: number;
  memory?: number;
  length?: number;
  lang?: string;
}

interface ProblemManagePageData {
  pdoc?: ProblemManageDocument;
  problemAuthoringCapabilities?: ProblemManageCapabilities;
  testdata?: ProblemManagedFile[];
  additional_file?: ProblemManagedFile[];
  reference?: Record<string, unknown> | null;
  dataWriteGuard?: ProblemDataWriteGuardState;
  psdocs?: ProblemSolutionDocument[];
  pssdict?: Record<string, { vote?: number }>;
  canCreateSolution?: boolean;
  canVoteSolution?: boolean;
  page?: string | number;
  pcount?: string | number;
  udict?: Record<string, GenericUserDoc>;
  rsdocs?: ProblemStatisticRecord[];
  sort?: string;
  direction?: string | number;
  lang?: string;
  langs?: Record<string, { display?: unknown }>;
  types?: string[];
  knowledgeMaps?: Array<{ id: string; title: string }>;
  canKeepOriginalAuthor?: boolean;
}

function getUser(udict: Record<string, GenericUserDoc>, uid: string | number | undefined) {
  return uid != null ? (udict[String(uid)] ?? null) : null;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/* ---------- Problem Config ---------- */

export { ProblemConfigPage } from './problem-config-page-wrapper';

/* ---------- Problem Files ---------- */

export function ProblemFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemManagePageData;
  const pdoc = data.pdoc || {};
  const capabilities = data.problemAuthoringCapabilities || {};
  const testdata = data.testdata || [];
  const additionalFile = data.additional_file || [];
  const reference = data.reference || null;
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const fileSection =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('section') === 'additional' ? 'additional' : 'testdata';
  const collaborationEnabled =
    capabilities.canManageCollaborators === true || capabilities.canManageContributions === true || capabilities.canPublish === true;

  const [selectedTestdata, setSelectedTestdata] = useState<Set<string>>(new Set());
  const [selectedAdditional, setSelectedAdditional] = useState<Set<string>>(new Set());
  const [renamingFiles, setRenamingFiles] = useState<Record<string, string>>({});
  const [renamingType, setRenamingType] = useState<'testdata' | 'additional_file'>('testdata');
  const [showGenerate, setShowGenerate] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<ProblemFileType | null>(null);
  const [previewingTestdataFile, setPreviewingTestdataFile] = useState<ProblemManagedFile | null>(null);
  const [downloadingType, setDownloadingType] = useState<ProblemFileType | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [uploadConfirmationRequestId, setUploadConfirmationRequestId] = useState('');
  const prepareDataWrite = useCallback(
    (operation: ProblemDataWriteOperation) => prepareProblemDataWrite(`${problemUrl}/files`, operation),
    [problemUrl],
  );
  const dataGuard = useProblemDataWriteGuard(data.dataWriteGuard, 'data', prepareDataWrite);
  const generatorCandidates = testdata.filter(
    (file) => !file.name.endsWith('.in') && !file.name.endsWith('.out') && !file.name.endsWith('.ans') && file.name !== 'config.yaml',
  );

  const toggleFile = (set: Set<string>, setFn: (s: Set<string>) => void, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setFn(next);
  };

  const toggleAll = (files: ProblemManagedFile[], selected: Set<string>, setSelected: (s: Set<string>) => void) => {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map((f) => f.name)));
  };

  const startRename = (selected: Set<string>, type: 'testdata' | 'additional_file') => {
    const mapping: Record<string, string> = {};
    for (const name of selected) mapping[name] = name;
    setRenamingType(type);
    setRenamingFiles(mapping);
  };

  const handleDownloadSelected = useCallback(
    async (selected: Set<string>, type: ProblemFileType) => {
      setDownloadError('');
      setDownloadingType(type);
      try {
        await downloadProblemFiles({ pdoc, problemUrl, files: Array.from(selected), type });
      } catch (error) {
        console.error('Problem files download failed', { type, files: Array.from(selected), error });
        setDownloadError(error instanceof Error ? error.message : '下载失败');
      } finally {
        setDownloadingType(null);
      }
    },
    [pdoc, problemUrl],
  );

  const guardedSubmit = (event: FormEvent<HTMLFormElement>, action: string, operation: ProblemDataWriteOperation) => {
    const form = event.currentTarget;
    event.preventDefault();
    if (dataGuard.blocked) return;
    void dataGuard.confirm(action, operation).then((confirmation) => {
      if (!confirmation) return;
      if (typeof confirmation === 'string') {
        const marker = document.createElement('input');
        marker.type = 'hidden';
        marker.name = 'activeContainerConfirmation';
        marker.value = confirmation;
        form.append(marker);
      }
      HTMLFormElement.prototype.submit.call(form);
    });
  };

  const toggleUpload = async (type: ProblemFileType) => {
    if (uploadTarget === type) {
      setUploadTarget(null);
      setUploadConfirmationRequestId('');
      return;
    }
    const confirmation = await dataGuard.confirm(`上传${type === 'testdata' ? '测试数据' : '附加文件'}`, 'files-upload');
    if (!confirmation) return;
    setUploadConfirmationRequestId(typeof confirmation === 'string' ? confirmation : '');
    setUploadTarget(type);
  };

  const FileSection = ({
    title,
    files,
    type,
    selected,
    setSelected,
  }: {
    title: string;
    files: ProblemManagedFile[];
    type: ProblemFileType;
    selected: Set<string>;
    setSelected: (s: Set<string>) => void;
  }) => (
    <section id={type === 'testdata' ? 'testdata' : 'additional-files'} className="scroll-mt-44 rounded-2xl border border-border/70 bg-card/30">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderOpen className="size-4" />
          {title} ({files.length})
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {/* Upload */}
          {!reference && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={dataGuard.blocked}
              onClick={() => void toggleUpload(type)}
              aria-expanded={uploadTarget === type}
            >
              <Upload className="mr-1 size-3" />
              上传
            </Button>
          )}
          {selected.size > 0 && (
            <>
              {/* Download */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={downloadingType !== null}
                onClick={() => void handleDownloadSelected(selected, type)}
              >
                <Download className="mr-1 size-3" />
                {downloadingType === type ? '准备下载…' : `下载 (${selected.size})`}
              </Button>
              {/* Rename */}
              {!reference && (
                <Button size="sm" variant="outline" disabled={dataGuard.blocked} onClick={() => startRename(selected, type)}>
                  <Pencil className="mr-1 size-3" />
                  重命名
                </Button>
              )}
              {/* Delete */}
              {!reference && (
                <form method="post" onSubmit={(event) => guardedSubmit(event, `删除 ${selected.size} 个文件`, 'files-delete')}>
                  <input type="hidden" name="operation" value="delete_files" />
                  <input type="hidden" name="type" value={type} />
                  {Array.from(selected).map((f) => (
                    <input key={f} type="hidden" name="files" value={f} />
                  ))}
                  <Button type="submit" size="sm" variant="destructive" disabled={dataGuard.blocked}>
                    <Trash2 className="mr-1 size-3" />
                    删除 ({selected.size})
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </CardHeader>
      {downloadError ? (
        <p role="alert" className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          下载失败：{downloadError}
        </p>
      ) : null}
      {uploadTarget === type ? (
        <div className="border-t border-border/60 p-4">
          <FileUploader
            endpoint={`${problemUrl}/files`}
            fieldName="file"
            meta={{ type, ...(uploadConfirmationRequestId ? { activeContainerConfirmation: uploadConfirmationRequestId } : {}) }}
            maxFileSize={null}
            maxFiles={null}
            uploadConcurrency={1}
            retryOnFailure={false}
            onBatchComplete={() => setTimeout(() => window.location.reload(), 600)}
          />
        </div>
      ) : null}
      <CardContent className="p-0">
        {files.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox checked={selected.size === files.length && files.length > 0} onChange={() => toggleAll(files, selected, setSelected)} />
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
                    <Checkbox checked={selected.has(f.name)} onChange={() => toggleFile(selected, setSelected, f.name)} />
                  </TableCell>
                  <TableCell>
                    {type === 'testdata' ? (
                      <button
                        type="button"
                        onClick={() => setPreviewingTestdataFile(f)}
                        className="font-mono text-sm text-primary hover:underline"
                        title="查看或编辑文件"
                      >
                        {f.name}
                      </button>
                    ) : (
                      <a
                        href={`${problemUrl}/file/${encodeURIComponent(f.name)}?type=${type}`}
                        className="font-mono text-sm text-primary hover:underline"
                      >
                        {f.name}
                      </a>
                    )}
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
    </section>
  );

  // Rename dialog
  const renameKeys = Object.keys(renamingFiles);

  return (
    <ProblemEditorWorkspace
      page="files"
      problemUrl={problemUrl}
      title={pdoc.title || String(pid)}
      pid={String(pid)}
      fileSection={fileSection}
      editEnabled={capabilities.canEditContent === true || capabilities.canEditTags === true}
      dataEnabled={capabilities.canEditData === true}
      collaborationEnabled={collaborationEnabled}
      canSubmit={capabilities.canSubmitProblem === true}
      actions={
        <Button asChild variant="outline" size="sm">
          <a href={problemUrl}>
            <ArrowLeft className="mr-1 size-3.5" />
            查看题目
          </a>
        </Button>
      }
    >
      <div className="space-y-6">
        {dataGuard.notice}
        {renameKeys.length > 0 ? (
          <section aria-labelledby="rename-heading" className="rounded-2xl border border-primary/30 bg-primary/[0.025] p-5">
            <h2 id="rename-heading" className="mb-4 text-sm font-semibold">
              重命名文件
            </h2>
            <form
              method="post"
              className="space-y-3"
              onSubmit={(event) => guardedSubmit(event, `重命名 ${renameKeys.length} 个文件`, 'files-rename')}
            >
              <input type="hidden" name="operation" value="rename_files" />
              <input type="hidden" name="type" value={renamingType} />
              {renameKeys.map((oldName) => (
                <div key={oldName} className="grid items-center gap-2 sm:grid-cols-[10rem_auto_minmax(0,20rem)]">
                  <input type="hidden" name="files" value={oldName} />
                  <span className="truncate font-mono text-sm text-muted-foreground">{oldName}</span>
                  <span className="text-muted-foreground">→</span>
                  <Input
                    name="newNames"
                    value={renamingFiles[oldName]}
                    onChange={(e) => setRenamingFiles({ ...renamingFiles, [oldName]: e.target.value })}
                    className="font-mono text-sm"
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  确认重命名
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setRenamingFiles({})}>
                  取消
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {reference ? (
          <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            此题目引用自其他题目，文件由源题目管理。
          </p>
        ) : null}

        {fileSection === 'testdata' ? (
          <FileSection title="测试数据" files={testdata} type="testdata" selected={selectedTestdata} setSelected={setSelectedTestdata} />
        ) : (
          <FileSection
            title="附加文件"
            files={additionalFile}
            type="additional_file"
            selected={selectedAdditional}
            setSelected={setSelectedAdditional}
          />
        )}

        {fileSection === 'testdata' && !reference && testdata.length > 0 ? (
          <section className="rounded-2xl border border-border/70 bg-card/30">
            <header className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Play className="size-4" />
                  生成测试数据
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">复用现有生成器与标准程序队列。</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowGenerate((value) => !value)} aria-expanded={showGenerate}>
                {showGenerate ? '收起' : '展开'}
              </Button>
            </header>
            {showGenerate ? (
              <div className="border-t border-border/60 p-5">
                <form method="post" className="space-y-3" onSubmit={(event) => guardedSubmit(event, '生成测试数据', 'generate-testdata-request')}>
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
                          ...generatorCandidates.map((file) => ({ value: file.name, label: file.name })),
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
                          ...generatorCandidates.map((file) => ({ value: file.name, label: file.name })),
                        ]}
                      />
                      <p className="text-xs text-muted-foreground">输出答案到 stdout 的程序</p>
                    </div>
                  </div>
                  <Button type="submit" size="sm" disabled={dataGuard.blocked}>
                    <RefreshCw className="mr-1 size-3.5" />
                    生成数据
                  </Button>
                </form>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      {previewingTestdataFile ? (
        <ProblemTestdataFileDialog
          file={previewingTestdataFile}
          problemUrl={problemUrl}
          onClose={() => setPreviewingTestdataFile(null)}
          confirmWrite={dataGuard.confirm}
        />
      ) : null}
      {dataGuard.dialog}
    </ProblemEditorWorkspace>
  );
}

/* ---------- Problem Solution ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSolutionId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (isRecord(value) && typeof value.$oid === 'string' && value.$oid.trim()) return value.$oid.trim();
  return '';
}

function solutionVoteOf(pssdict: Record<string, { vote?: number }>, ps: ProblemSolutionDocument): number {
  const keys = [asSolutionId(ps._id), asSolutionId(ps.docId)].filter(Boolean);
  for (const key of keys) {
    const vote = pssdict[key]?.vote;
    if (vote === 1 || vote === -1) return vote;
  }
  return 0;
}

function parseSolutionPageData(raw: unknown): {
  pdoc: ProblemManageDocument;
  psdocs: ProblemSolutionDocument[];
  pssdict: Record<string, { vote?: number }>;
  page: number;
  pcount: number;
  udict: Record<string, GenericUserDoc>;
  canCreateSolution: boolean;
  canVoteSolution: boolean;
} {
  const rec = isRecord(raw) ? raw : {};
  const pdoc = isRecord(rec.pdoc) ? (rec.pdoc as ProblemManageDocument) : {};
  const psdocs = Array.isArray(rec.psdocs) ? (rec.psdocs as ProblemSolutionDocument[]) : [];
  const pssdict: Record<string, { vote?: number }> = {};
  if (isRecord(rec.pssdict)) {
    for (const [key, value] of Object.entries(rec.pssdict)) {
      if (!isRecord(value)) continue;
      pssdict[key] = { vote: typeof value.vote === 'number' ? value.vote : 0 };
    }
  }
  const udict = isRecord(rec.udict) ? (rec.udict as Record<string, GenericUserDoc>) : {};
  return {
    pdoc,
    psdocs,
    pssdict,
    page: Number(rec.page) || 1,
    pcount: Number(rec.pcount) || 1,
    udict,
    canCreateSolution: rec.canCreateSolution === true,
    canVoteSolution: rec.canVoteSolution === true,
  };
}

export function ProblemSolutionPage() {
  const bs = useBootstrap();
  const data = parseSolutionPageData(bs.page.data);
  const pdoc = data.pdoc;
  const psdocs = data.psdocs;
  const page = data.page;
  const pcount = data.pcount;
  const udict: Record<string, GenericUserDoc> = Object.keys(bs.udict || {}).length ? bs.udict : data.udict;
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState('');

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <a href={problemUrl}>
              <ArrowLeft className="size-4" />
            </a>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">题解</h1>
            <p className="text-sm text-muted-foreground">{pdoc.title || pid}</p>
          </div>
        </div>
        {data.canCreateSolution ? (
          <Button
            onClick={() => {
              setEditingId('');
              setShowForm((open) => !open);
            }}
          >
            <MessageSquare className="mr-1 size-4" />
            发布题解
          </Button>
        ) : null}
      </div>

      {showForm && data.canCreateSolution ? (
        <Card>
          <CardContent className="p-4">
            <form method="post" className="space-y-3">
              <input type="hidden" name="operation" value="submit" />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">题解内容 (Markdown)</label>
                <MarkdownEditor name="content" value="" minHeight={320} preferredLang={bs.locale} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" type="button" onClick={() => setShowForm(false)}>
                  取消
                </Button>
                <Button type="submit">提交</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {psdocs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">暂无题解</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {psdocs.map((ps) => {
            const owner = getUser(udict, ps.owner);
            const psid = asSolutionId(ps.docId) || asSolutionId(ps._id);
            const userVote = solutionVoteOf(data.pssdict, ps);
            const editing = editingId === psid && psid !== '';
            return (
              <Card key={psid || String(ps._id)}>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{owner?.uname || `UID ${ps.owner}`}</p>
                      <p className="text-xs text-muted-foreground">{ps.updateAt ? formatRelativeTime(ps.updateAt, bs.locale) : ''}</p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {ps.canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => {
                            setShowForm(false);
                            setEditingId((current) => (current === psid ? '' : psid));
                          }}
                        >
                          <Pencil className="mr-1 size-3.5" />
                          {editing ? '取消编辑' : '编辑'}
                        </Button>
                      ) : null}
                      {ps.canDelete ? (
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="delete_solution" />
                          <input type="hidden" name="psid" value={psid} />
                          <Button type="submit" variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive">
                            <Trash2 className="mr-1 size-3.5" />
                            删除
                          </Button>
                        </form>
                      ) : null}
                      {data.canVoteSolution ? (
                        <>
                          <form method="post" className="inline">
                            <input type="hidden" name="operation" value="upvote" />
                            <input type="hidden" name="psid" value={psid} />
                            <button
                              type="submit"
                              className={cn(
                                'flex items-center gap-1 text-sm hover:text-primary',
                                userVote === 1 ? 'text-primary' : 'text-muted-foreground',
                              )}
                              aria-pressed={userVote === 1}
                              aria-label={userVote === 1 ? '取消点赞' : '点赞'}
                            >
                              <ThumbsUp className="size-3.5" />
                              {ps.vote || 0}
                            </button>
                          </form>
                          <form method="post" className="inline">
                            <input type="hidden" name="operation" value="downvote" />
                            <input type="hidden" name="psid" value={psid} />
                            <button
                              type="submit"
                              className={cn(
                                'flex items-center gap-1 text-sm hover:text-destructive',
                                userVote === -1 ? 'text-destructive' : 'text-muted-foreground',
                              )}
                              aria-pressed={userVote === -1}
                              aria-label={userVote === -1 ? '取消点踩' : '点踩'}
                            >
                              <ThumbsDown className="size-3.5" />
                            </button>
                          </form>
                        </>
                      ) : (
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <ThumbsUp className="size-3.5" />
                          {ps.vote || 0}
                        </span>
                      )}
                    </div>
                  </div>
                  {editing ? (
                    <form method="post" className="space-y-3">
                      <input type="hidden" name="operation" value="edit_solution" />
                      <input type="hidden" name="psid" value={psid} />
                      <MarkdownEditor name="content" value={ps.content || ''} minHeight={320} preferredLang={bs.locale} />
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setEditingId('')}>
                          取消
                        </Button>
                        <Button type="submit">保存</Button>
                      </div>
                    </form>
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <MarkdownView content={ps.content || ''} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pcount > 1 && (
        <div className="flex justify-center">
          <Pagination current={page} total={pcount} baseUrl="?" />
        </div>
      )}
    </motion.div>
  );
}

/* ---------- Problem Statistics ---------- */

export function ProblemStatisticsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as ProblemManagePageData;
  const pdoc = data.pdoc || {};
  const rsdocs = data.rsdocs || [];
  const page = Number(data.page) || 1;
  const pcount = Number(data.pcount) || 1;
  const sort: string = data.sort || 'time';
  const direction: number = Number(data.direction) || 1;
  const currentLang: string = data.lang || '';
  const langs: Record<string, { display?: unknown }> = data.langs || {};
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
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={problemUrl}>
            <ArrowLeft className="size-4" />
          </a>
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
              <SimpleSelect name="sort" defaultValue={sort} options={types.map((type) => ({ value: type, label: SORT_LABELS[type] || type }))} />
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
                    label: String(lang.display || key),
                  })),
                ]}
              />
            </div>
            <Button type="submit" size="sm">
              筛选
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <Button key={t} asChild variant={sort === t ? 'default' : 'outline'} size="sm">
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
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">
                          {r.lang || '-'}
                        </Badge>
                      </TableCell>
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
  const data = useBootstrap().page.data as ProblemManagePageData;
  const knowledgeMaps = data.knowledgeMaps || [];
  const defaultMapId = knowledgeMaps.length === 1 ? knowledgeMaps[0].id : '';
  const canKeepOriginalAuthor = data.canKeepOriginalAuthor === true;
  return (
    <AdminPage bypassPrivGate title="导入题目" description="将 Hydro 题目包导入为隐藏的自命题托管草稿">
      <Card>
        <CardContent className="p-6">
          <form method="post" encType="multipart/form-data" className="grid gap-4 sm:max-w-xl">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">题目文件</label>
              <input type="file" name="file" accept=".zip" required className="w-full text-sm" />
              <p className="text-xs text-muted-foreground">支持 .zip 格式的 Hydro 题目包</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="knowledge-map" className="text-sm font-medium">
                所属导图
              </label>
              <SimpleSelect
                id="knowledge-map"
                name="knowledgeMapId"
                defaultValue={defaultMapId}
                required
                placeholder="请选择导图"
                options={knowledgeMaps.map((map) => ({ value: map.id, label: map.title }))}
              />
              <p className="text-xs text-muted-foreground">系统自动分配题号；知识节点可在导入后逐题归类。</p>
            </div>
            {canKeepOriginalAuthor ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="keepUser" value="true" />
                保留题目包中的原出题人
              </label>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit">
                <Import className="mr-1 size-4" />
                导入
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
