/**
 * Problem management pages — config, files, solutions, statistics, import.
 */

import { type FormEvent, useCallback, useState } from 'react';
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
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
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

function toggleFile(set: Set<string>, setFn: (s: Set<string>) => void, name: string) {
  const next = new Set(set);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  setFn(next);
}

function toggleAll(files: ProblemManagedFile[], selected: Set<string>, setSelected: (s: Set<string>) => void) {
  if (selected.size === files.length) setSelected(new Set());
  else setSelected(new Set(files.map((f) => f.name)));
}

interface ProblemFileSectionProps {
  title: string;
  files: ProblemManagedFile[];
  type: ProblemFileType;
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  reference: Record<string, unknown> | null;
  dataGuard: { blocked: boolean };
  toggleUpload: (type: ProblemFileType) => Promise<void>;
  uploadTarget: ProblemFileType | null;
  downloadingType: ProblemFileType | null;
  handleDownloadSelected: (selected: Set<string>, type: ProblemFileType) => Promise<void>;
  startRename: (selected: Set<string>, type: ProblemFileType) => void;
  guardedSubmit: (event: FormEvent<HTMLFormElement>, action: string, operation: ProblemDataWriteOperation) => void;
  downloadError: string;
  problemUrl: string;
  uploadConfirmationRequestId: string;
  setPreviewingTestdataFile: (file: ProblemManagedFile) => void;
  locale: string;
}

function FileSection({
  title,
  files,
  type,
  selected,
  setSelected,
  reference,
  dataGuard,
  toggleUpload,
  uploadTarget,
  downloadingType,
  handleDownloadSelected,
  startRename,
  guardedSubmit,
  downloadError,
  problemUrl,
  uploadConfirmationRequestId,
  setPreviewingTestdataFile,
  locale,
}: ProblemFileSectionProps) {
  return (
    <section id={type === 'testdata' ? 'testdata' : 'additional-files'} className="scroll-mt-24">
      <Panel
        flush
        title={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="min-w-0 truncate">{title}</span>
            <span className="shrink-0 text-fg-subtle tabular">({files.length})</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!reference && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={dataGuard.blocked}
                onClick={() => void toggleUpload(type)}
                aria-expanded={uploadTarget === type}
              >
                <Upload />
                上传
              </Button>
            )}
            {selected.size > 0 && (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={downloadingType !== null}
                  onClick={() => void handleDownloadSelected(selected, type)}
                >
                  <Download />
                  {downloadingType === type ? '准备下载…' : `下载 (${selected.size})`}
                </Button>
                {!reference && (
                  <Button size="sm" variant="secondary" disabled={dataGuard.blocked} onClick={() => startRename(selected, type)}>
                    <Pencil />
                    重命名
                  </Button>
                )}
                {!reference && (
                  <form method="post" onSubmit={(event) => guardedSubmit(event, `删除 ${selected.size} 个文件`, 'files-delete')}>
                    <input type="hidden" name="operation" value="delete_files" />
                    <input type="hidden" name="type" value={type} />
                    {Array.from(selected).map((f) => (
                      <input key={f} type="hidden" name="files" value={f} />
                    ))}
                    <Button type="submit" size="sm" variant="danger-soft" disabled={dataGuard.blocked}>
                      <Trash2 />
                      删除 ({selected.size})
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
        }
      >
        {downloadError ? (
          <div className="px-4 pt-4">
            <Alert tone="danger">下载失败：{downloadError}</Alert>
          </div>
        ) : null}
        {uploadTarget === type ? (
          <div className="border-t border-line-subtle p-4">
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
        {files.length > 0 ? (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === files.length && files.length > 0} onChange={() => toggleAll(files, selected, setSelected)} />
                </TableHead>
                <TableHead className="min-w-0">文件名</TableHead>
                <TableHead className="w-24 text-right">大小</TableHead>
                <TableHead className="w-60 text-right">修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.name} className={selected.has(f.name) ? 'bg-brand-soft/60' : undefined}>
                  <TableCell>
                    <Checkbox checked={selected.has(f.name)} onChange={() => toggleFile(selected, setSelected, f.name)} />
                  </TableCell>
                  <TableCell className="min-w-0">
                    {type === 'testdata' ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="w-full min-w-0 justify-start"
                        onClick={() => setPreviewingTestdataFile(f)}
                        title={f.name}
                      >
                        <span className="min-w-0 truncate font-mono">{f.name}</span>
                      </Button>
                    ) : (
                      <a
                        href={`${problemUrl}/file/${encodeURIComponent(f.name)}?type=${type}`}
                        className="block min-w-0 truncate font-mono text-sm text-brand-fg hover:underline"
                        title={f.name}
                      >
                        {f.name}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm text-fg-subtle tabular">{formatSize(f.size || 0)}</TableCell>
                  <TableCell className="text-right text-sm text-fg-subtle tabular">
                    {f.lastModified ? formatDateTime(f.lastModified, locale) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState compact icon={<FolderOpen />} title="暂无文件" />
        )}
      </Panel>
    </section>
  );
}

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
        <Button asChild variant="secondary" size="sm">
          <a href={problemUrl}>
            <ArrowLeft />
            查看题目
          </a>
        </Button>
      }
    >
      <Page width="wide">
        <PageHeader title={fileSection === 'testdata' ? '测试数据' : '附加文件'} description={pdoc.title || String(pid)} />
        {dataGuard.notice}
        {renameKeys.length > 0 ? (
          <section aria-labelledby="rename-heading">
            <Panel>
              <h2 id="rename-heading" className="mb-4 text-sm font-semibold text-fg">
                重命名文件
              </h2>
              <form
                method="post"
                className="flex flex-col gap-5"
                onSubmit={(event) => guardedSubmit(event, `重命名 ${renameKeys.length} 个文件`, 'files-rename')}
              >
                <input type="hidden" name="operation" value="rename_files" />
                <input type="hidden" name="type" value={renamingType} />
                {renameKeys.map((oldName) => (
                  <div key={oldName} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="hidden" name="files" value={oldName} />
                    <span className="min-w-0 truncate font-mono text-sm text-fg-subtle sm:w-60" title={oldName}>
                      {oldName}
                    </span>
                    <span className="shrink-0 text-fg-subtle">→</span>
                    <Input
                      name="newNames"
                      value={renamingFiles[oldName]}
                      onChange={(e) => setRenamingFiles({ ...renamingFiles, [oldName]: e.target.value })}
                      className="min-w-0 font-mono sm:w-80"
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="primary">
                    确认重命名
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setRenamingFiles({})}>
                    取消
                  </Button>
                </div>
              </form>
            </Panel>
          </section>
        ) : null}

        {reference ? <Alert tone="warning">此题目引用自其他题目，文件由源题目管理。</Alert> : null}

        {fileSection === 'testdata' ? (
          <FileSection
            title="测试数据"
            files={testdata}
            type="testdata"
            selected={selectedTestdata}
            setSelected={setSelectedTestdata}
            reference={reference}
            dataGuard={dataGuard}
            toggleUpload={toggleUpload}
            uploadTarget={uploadTarget}
            downloadingType={downloadingType}
            handleDownloadSelected={handleDownloadSelected}
            startRename={startRename}
            guardedSubmit={guardedSubmit}
            downloadError={downloadError}
            problemUrl={problemUrl}
            uploadConfirmationRequestId={uploadConfirmationRequestId}
            setPreviewingTestdataFile={setPreviewingTestdataFile}
            locale={bs.locale}
          />
        ) : (
          <FileSection
            title="附加文件"
            files={additionalFile}
            type="additional_file"
            selected={selectedAdditional}
            setSelected={setSelectedAdditional}
            reference={reference}
            dataGuard={dataGuard}
            toggleUpload={toggleUpload}
            uploadTarget={uploadTarget}
            downloadingType={downloadingType}
            handleDownloadSelected={handleDownloadSelected}
            startRename={startRename}
            guardedSubmit={guardedSubmit}
            downloadError={downloadError}
            problemUrl={problemUrl}
            uploadConfirmationRequestId={uploadConfirmationRequestId}
            setPreviewingTestdataFile={setPreviewingTestdataFile}
            locale={bs.locale}
          />
        )}

        {fileSection === 'testdata' && !reference && testdata.length > 0 ? (
          <Panel
            flush
            title={
              <span className="inline-flex items-center gap-1.5">
                <Play className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                生成测试数据
              </span>
            }
            description="复用现有生成器与标准程序队列。"
            actions={
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowGenerate((value) => !value)} aria-expanded={showGenerate}>
                {showGenerate ? '收起' : '展开'}
              </Button>
            }
          >
            {showGenerate ? (
              <form
                method="post"
                className="flex flex-col gap-5 p-4"
                onSubmit={(event) => guardedSubmit(event, '生成测试数据', 'generate-testdata-request')}
              >
                <input type="hidden" name="operation" value="generate_testdata" />
                <FormRow columns={2} className="gap-5">
                  <FormField label="数据生成器" hint="输出测试数据到 stdout 的程序">
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
                  </FormField>
                  <FormField label="标准程序" hint="输出答案到 stdout 的程序">
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
                  </FormField>
                </FormRow>
                <div>
                  <Button type="submit" size="sm" variant="secondary" disabled={dataGuard.blocked}>
                    <RefreshCw />
                    生成数据
                  </Button>
                </div>
              </form>
            ) : null}
          </Panel>
        ) : null}
      </Page>
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
  const composing = showForm || editingId !== '';

  return (
    <Page width="wide">
      <PageHeader
        title="题解"
        description={pdoc.title || String(pid)}
        breadcrumb={
          <Button asChild variant="ghost" size="sm" iconOnly>
            <a href={problemUrl} aria-label="返回题目">
              <ArrowLeft />
            </a>
          </Button>
        }
        actions={
          data.canCreateSolution ? (
            <Button
              type="button"
              variant={composing ? 'secondary' : 'primary'}
              onClick={() => {
                setEditingId('');
                setShowForm((open) => !open);
              }}
            >
              <MessageSquare />
              发布题解
            </Button>
          ) : null
        }
      />

      {showForm && data.canCreateSolution ? (
        <Panel>
          <form method="post" className="flex flex-col gap-5">
            <input type="hidden" name="operation" value="submit" />
            <FormField label="题解内容 (Markdown)">
              <MarkdownEditor name="content" value="" minHeight={320} preferredLang={bs.locale} />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowForm(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary">
                提交
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {psdocs.length === 0 ? (
        <Panel>
          <EmptyState icon={<MessageSquare />} title="暂无题解" />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {psdocs.map((ps) => {
            const owner = getUser(udict, ps.owner);
            const psid = asSolutionId(ps.docId) || asSolutionId(ps._id);
            const userVote = solutionVoteOf(data.pssdict, ps);
            const editing = editingId === psid && psid !== '';
            return (
              <Panel key={psid || String(ps._id)}>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="text-xs">{makeInitials(owner?.uname || '?')}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{owner?.uname || `UID ${ps.owner}`}</p>
                      <p className="text-xs text-fg-subtle">{ps.updateAt ? formatRelativeTime(ps.updateAt, bs.locale) : ''}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {ps.canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setShowForm(false);
                          setEditingId((current) => (current === psid ? '' : psid));
                        }}
                      >
                        <Pencil />
                        {editing ? '取消编辑' : '编辑'}
                      </Button>
                    ) : null}
                    {ps.canDelete ? (
                      <form method="post" className="inline">
                        <input type="hidden" name="operation" value="delete_solution" />
                        <input type="hidden" name="psid" value={psid} />
                        <Button type="submit" variant="danger-soft" size="sm">
                          <Trash2 />
                          删除
                        </Button>
                      </form>
                    ) : null}
                    {data.canVoteSolution ? (
                      <>
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="upvote" />
                          <input type="hidden" name="psid" value={psid} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className={cn(userVote === 1 ? 'text-brand-fg' : undefined, 'hover:text-brand-fg')}
                            aria-pressed={userVote === 1}
                            aria-label={userVote === 1 ? '取消点赞' : '点赞'}
                          >
                            <ThumbsUp />
                            <span className="tabular">{ps.vote || 0}</span>
                          </Button>
                        </form>
                        <form method="post" className="inline">
                          <input type="hidden" name="operation" value="downvote" />
                          <input type="hidden" name="psid" value={psid} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className={cn(userVote === -1 ? 'text-danger-fg' : undefined, 'hover:text-danger-fg')}
                            aria-pressed={userVote === -1}
                            aria-label={userVote === -1 ? '取消点踩' : '点踩'}
                          >
                            <ThumbsDown />
                          </Button>
                        </form>
                      </>
                    ) : (
                      <span className="flex items-center gap-1.5 text-sm text-fg-subtle">
                        <ThumbsUp className="size-3.5 shrink-0" />
                        <span className="tabular">{ps.vote || 0}</span>
                      </span>
                    )}
                  </div>
                </div>
                {editing ? (
                  <form method="post" className="flex flex-col gap-5">
                    <input type="hidden" name="operation" value="edit_solution" />
                    <input type="hidden" name="psid" value={psid} />
                    <MarkdownEditor name="content" value={ps.content || ''} minHeight={320} preferredLang={bs.locale} />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="secondary" onClick={() => setEditingId('')}>
                        取消
                      </Button>
                      <Button type="submit" variant="primary">
                        保存
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="prose prose-sm max-w-none">
                    <MarkdownView content={ps.content || ''} />
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {pcount > 1 && (
        <div className="flex justify-center">
          <Pagination current={page} total={pcount} baseUrl="?" />
        </div>
      )}
    </Page>
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
    <Page width="wide">
      <PageHeader
        title="提交统计"
        description={pdoc.title || String(pid)}
        breadcrumb={
          <Button asChild variant="ghost" size="sm" iconOnly>
            <a href={problemUrl} aria-label="返回题目">
              <ArrowLeft />
            </a>
          </Button>
        }
      />

      <Panel>
        <form method="get">
          <FormRow columns={2} className="items-end gap-5 lg:grid-cols-4">
            <FormField label="排序字段">
              <SimpleSelect name="sort" defaultValue={sort} options={types.map((type) => ({ value: type, label: SORT_LABELS[type] || type }))} />
            </FormField>
            <FormField label="方向">
              <SimpleSelect
                name="direction"
                defaultValue={String(direction)}
                options={[
                  { value: '1', label: '升序' },
                  { value: '-1', label: '降序' },
                ]}
              />
            </FormField>
            <FormField label="语言">
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
            </FormField>
            <Button type="submit" variant="primary" size="sm" className="w-full sm:w-auto">
              筛选
            </Button>
          </FormRow>
        </form>
      </Panel>

      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <Button key={t} asChild variant={sort === t ? 'soft' : 'secondary'} size="sm">
            <a href={statQuery(t, sort === t ? -direction : 1)}>
              {SORT_LABELS[t] || t}
              {sort === t && (direction === 1 ? <ChevronUp /> : <ChevronDown />)}
            </a>
          </Button>
        ))}
      </div>

      <Panel flush>
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
                    <TableCell className="min-w-0">
                      <a
                        href={replaceRouteTokens(bs.urls.userDetail, { UID: String(r.uid) })}
                        className="block min-w-0 truncate text-sm text-brand-fg hover:underline"
                      >
                        {u?.uname || `UID ${r.uid}`}
                      </a>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular">{r.time != null ? `${r.time}ms` : '-'}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular">{r.memory != null ? `${(r.memory / 1024).toFixed(0)}KB` : '-'}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular">{r.length != null ? `${r.length}B` : '-'}</TableCell>
                    <TableCell className="text-right">
                      <Badge tone="neutral" variant="outline">
                        {r.lang || '-'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="暂无统计数据" />
        )}
      </Panel>

      {pcount > 1 && (
        <div className="flex justify-center">
          <Pagination current={page} total={pcount} baseUrl={statQuery()} />
        </div>
      )}
    </Page>
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
      <Panel>
        <form method="post" encType="multipart/form-data" className="grid gap-5">
          <FormField label="题目文件" htmlFor="problem-import-file" hint="支持 .zip 格式的 Hydro 题目包">
            <input id="problem-import-file" type="file" name="file" accept=".zip" required className="w-full text-sm text-fg" />
          </FormField>
          <FormField label="所属导图" htmlFor="knowledge-map" hint="系统自动分配题号；知识节点可在导入后逐题归类。">
            <SimpleSelect
              id="knowledge-map"
              name="knowledgeMapId"
              defaultValue={defaultMapId}
              required
              placeholder="请选择导图"
              options={knowledgeMaps.map((map) => ({ value: map.id, label: map.title }))}
            />
          </FormField>
          {canKeepOriginalAuthor ? (
            <label className="flex items-center gap-2 text-sm text-fg">
              <Checkbox name="keepUser" value="true" />
              保留题目包中的原出题人
            </label>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              <Import />
              导入
            </Button>
          </div>
        </form>
      </Panel>
    </AdminPage>
  );
}
