/**
 * Problem edit page — form for editing problem title, content, tags,
 * difficulty, visibility, PID, with sidebar navigation and delete.
 */

import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react';
import { motion } from 'motion/react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Save,
  Tag,
  FileText,
  Trash2,
  Flag,
  Send,
  Lightbulb,
  FolderOpen,
  BarChart3,
  Pencil,
  Settings,
  Download,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Checkbox } from '@/components/ui/checkbox';
import { SimpleSelect } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { cn } from '@/lib/cn';
import { downloadProblemPackage } from '@/lib/problem-package';
import {
  buildConfigYaml, CommunicationEditor, FillFunctionEditor, InteractiveEditor,
  ObjectiveEditor, parseConfigYaml, type ProblemType, type ProblemTypeState,
  SubmitAnswerEditor, TypePicker,
} from '@/pages/problem-type-editor';

type R = Record<string, any>;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const DIFFICULTY_OPTIONS = [
  { value: '', label: '未评定' },
  { value: 1, label: '入门' },
  { value: 2, label: '普及−' },
  { value: 3, label: '普及/提高−' },
  { value: 4, label: '普及+/提高' },
  { value: 5, label: '提高+/省选−' },
  { value: 6, label: '省选/NOI−' },
  { value: 7, label: '省选/NOI' },
  { value: 8, label: 'NOI/NOI+' },
  { value: 9, label: 'NOI+/CTSC' },
  { value: 10, label: 'CTSC/IOI' },
];

/* ---------- Sidebar navigation ---------- */

function ProblemSidebar({ pid: _pid, problemUrl, active }: { pid: string; problemUrl: string; active: string }) {
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

/* ---------- Additional files sidebar section ---------- */

function AdditionalFilesSidebar({ files, problemUrl }: { files: R[]; problemUrl: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">附加文件</h3>
        <a href={`${problemUrl}/files`} className="text-xs text-primary hover:underline">管理</a>
      </div>
      {files.length > 0 ? (
        <div className="space-y-1">
          {files.slice(0, 10).map((f) => (
            <div key={f.name} className="flex items-center justify-between text-xs">
              <span className="truncate font-mono text-muted-foreground" title={f.name}>{f.name}</span>
              <span className="ml-2 shrink-0 text-muted-foreground/60">{formatSize(f.size || 0)}</span>
            </div>
          ))}
          {files.length > 10 && (
            <p className="text-xs text-muted-foreground">+{files.length - 10} 个文件</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">暂无附加文件</p>
      )}
    </div>
  );
}

/* ---------- Permits panel ---------- */

interface PermitRow {
  _id: string;
  pid: number;
  uid: number;
  role: 'verifier' | 'maintainer';
  grantedBy: number;
  grantedAt: string;
  viaContest: string | null;
  note: string;
}

interface UserOption {
  _id: number;
  uname?: string;
  mail?: string;
  avatarUrl?: string;
}

function PermitsPanel({ pid, pdocId, hidden }: { pid: string; pdocId: number; hidden: boolean }) {
  const bs = useBootstrap();
  const [permits, setPermits] = useState<PermitRow[]>([]);
  const [udict, setUdict] = useState<Record<string, { _id: number; uname: string }>>({});
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const apiPid = String(pdocId || pid);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/p/${apiPid}/permits`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const j = await r.json();
      setPermits(j.permits || []);
      setUdict(j.udict || {});
      setLoaded(true);
    } catch { /* ignore */ }
  }, [apiPid]);
  useEffect(() => { refresh(); }, [refresh]);

  const searchUsers = useCallback(async (query: string): Promise<UserOption[]> => {
    const q = query.trim();
    if (!q) return [];
    const domainId = encodeURIComponent(bs.domain?.id || 'system');
    const r = await fetch(`/d/${domainId}/api/users`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        args: { search: q, limit: 10, exact: false },
        projection: ['_id', 'uname', 'mail', 'avatarUrl'],
      }),
    });
    if (!r.ok) return [];
    const users = await r.json();
    return Array.isArray(users) ? users : [];
  }, [bs.domain?.id]);

  async function revoke(permitId: string) {
    if (!confirm('确定撤销该权限？')) return;
    const fd = new FormData();
    fd.set('permitId', permitId);
    const r = await fetch(`/p/${apiPid}/permits/revoke`, { method: 'POST', body: fd, credentials: 'include' });
    if (r.ok) refresh();
  }

  async function submitInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteError('');
    if (!selectedUsers.length) {
      setInviteError('请选择至少一个用户');
      return;
    }
    setInviteBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set('uids', selectedUsers.map((u) => String(u._id)).join(','));
      const r = await fetch(`/p/${apiPid}/permits`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        let message = '发送邀请失败';
        try {
          const j = await r.json();
          message = j.error || j.message || message;
        } catch {
          const text = await r.text().catch(() => '');
          if (text) message = text.slice(0, 160);
        }
        setInviteError(message);
        return;
      }
      setSelectedUsers([]);
      setOpen(false);
      await refresh();
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>验题人 / 维护者</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!hidden}>
            邀请
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hidden ? (
          <p className="text-xs text-muted-foreground">
            题目当前不是隐藏状态，无需邀请验题人。把题目设为「隐藏」并保存后即可邀请。
          </p>
        ) : !loaded ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : permits.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有被邀请的验题人</p>
        ) : (
          <ul className="divide-y">
            {permits.map((p) => (
              <li key={p._id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{udict[p.uid]?.uname || `uid:${p.uid}`}</span>
                    <Badge variant={p.role === 'maintainer' ? 'default' : 'secondary'} className="text-[10px]">
                      {p.role === 'maintainer' ? '维护者' : '验题人'}
                    </Badge>
                    {p.viaContest ? (
                      <Badge variant="outline" className="text-[10px]">通过比赛邀请</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    由 {udict[p.grantedBy]?.uname || `uid:${p.grantedBy}`} 邀请于{' '}
                    {new Date(p.grantedAt).toLocaleString('zh-CN')}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => revoke(p._id)}>
                  撤销
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (!v) setInviteError('');
      }}>
        <DialogContent className="w-full overflow-visible sm:w-[560px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>邀请验题人</DialogTitle>
          </DialogHeader>
          <form
            method="post"
            action={`/p/${apiPid}/permits`}
            className="space-y-4 p-5"
            onSubmit={submitInvite}
          >
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">用户 UID</label>
              <MultiSelect<UserOption>
                value={selectedUsers}
                onChange={(next) => {
                  setSelectedUsers(next);
                  if (next.length) setInviteError('');
                }}
                loadOptions={searchUsers}
                getKey={(u) => String(u._id)}
                getLabel={(u) => `${u.uname || `uid:${u._id}`} ${u._id} ${u.mail || ''}`}
                renderChip={(u) => (
                  <span className="inline-flex items-center gap-1">
                    <span className="font-medium">{u.uname || `uid:${u._id}`}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">#{u._id}</span>
                  </span>
                )}
                renderOption={(u) => (
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {u.uname || `uid:${u._id}`}
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">UID {u._id}</span>
                    </span>
                    {u.mail ? <span className="truncate text-[11px] text-muted-foreground">{u.mail}</span> : null}
                  </span>
                )}
                name="uids"
                placeholder="输入 UID / 用户名 / 邮箱搜索"
                emptyText="没有找到用户"
                minHeight={44}
              />
            </div>
            {/* Role is fixed to "verifier" — only read access is granted.
                The data model keeps a `role` field for future extension
                to a real edit role, but the workflow today is read-only:
                verifier finds issues, DMs author, author edits. */}
            <input type="hidden" name="role" value="verifier" />
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="permit-note">附言（可选，会附在通知里）</label>
              <Input id="permit-note" name="note" placeholder="例：帮我测一下边界数据" />
            </div>
            {inviteError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {inviteError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={inviteBusy}>取消</Button>
              <Button type="submit" disabled={inviteBusy || selectedUsers.length === 0}>
                {inviteBusy ? '发送中…' : '发送邀请'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ---------- Main edit page ---------- */

export function ProblemEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data;
  const pdoc: R = data.pdoc || {};

  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const additionalFiles: R[] = data.additional_file || [];
  const testdataFiles: R[] = data.testdata || pdoc.data || [];

  const rawContent = pdoc.content || '';
  const contentValue = typeof rawContent === 'string' || (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent))
    ? rawContent
    : String(rawContent || '');
  const [draftContent, setDraftContent] = useState<string | R>(contentValue);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  // Tag input
  const tags: string[] = pdoc.tag || [];
  const [tagInput, setTagInput] = useState(tags.join(', '));

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Problem-type state — loaded from config.yaml on mount, persisted on save.
  // For /p/create the pdoc has no docId so we can't read config; default state.
  const [typeState, setTypeState] = useState<ProblemTypeState>({
    type: 'default', objective: [],
    template: '', expectedAnswer: '', interactor: '', manager: '',
  });
  const [configYamlRaw, setConfigYamlRaw] = useState<string>('');
  const isCreate = !pdoc.docId;
  const problemId = pdoc.docId ? String(pdoc.docId) : '';
  // ProblemDetailUrl-style API for the file endpoints.
  const filesBase = pdoc.docId ? `${problemUrl}/files` : '';

  const handleDownloadPackage = useCallback(async () => {
    if (isCreate || !problemUrl) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const fd = formRef.current ? new FormData(formRef.current) : null;
      const packagePdoc = fd ? {
        ...pdoc,
        pid: String(fd.get('pid') || pdoc.pid || ''),
        title: String(fd.get('title') || pdoc.title || ''),
        tag: String(fd.get('tag') || '')
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        difficulty: Number(fd.get('difficulty') || pdoc.difficulty || 0),
      } : pdoc;
      await downloadProblemPackage({
        pdoc: packagePdoc,
        problemUrl,
        testdata: testdataFiles,
        additionalFiles,
        content: draftContent,
      });
    } catch (e: any) {
      setDownloadError(e?.message || '下载失败');
    } finally {
      setDownloading(false);
    }
  }, [additionalFiles, draftContent, isCreate, pdoc, problemUrl, testdataFiles]);

  useEffect(() => {
    if (!problemId || !pid) return;
    // Pull existing config.yaml so the type-specific editor reflects what's on testdata.
    fetch(`${problemUrl}/file/config.yaml?type=testdata`, { method: 'GET' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (!text) return;
        setConfigYamlRaw(text);
        setTypeState((prev) => ({ ...prev, ...parseConfigYaml(text) }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, pid]);

  const setType = useCallback((next: ProblemType) => {
    setTypeState((prev) => ({ ...prev, type: next }));
  }, []);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    // For brand-new problems we have no pid yet — let the form submit
    // natively so Hydro creates it. The user can come back and edit the
    // type after the initial create lands.
    if (isCreate) return; // submit natively
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    // 1) Regular edit POST.
    const editRes = await fetch(form.action || window.location.pathname, {
      method: 'POST',
      body: new URLSearchParams(fd as any),
    });
    // 2) Write the type-specific config.yaml as a testdata file.
    if (filesBase) {
      const yamlText = buildConfigYaml(typeState, configYamlRaw);
      const cfgForm = new FormData();
      cfgForm.append('type', 'testdata');
      cfgForm.append('filename', 'config.yaml');
      cfgForm.append('file', new Blob([yamlText], { type: 'text/yaml' }), 'config.yaml');
      await fetch(filesBase, { method: 'POST', body: cfgForm }).catch(() => {});
    }
    if (editRes.ok || editRes.redirected) {
      window.location.assign(problemUrl);
    } else {
      alert('保存失败：' + editRes.statusText);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <a href={bs.urls.problems} className="hover:text-primary">题库</a>
        <ChevronRight className="size-3" />
        <a href={problemUrl} className="font-mono hover:text-primary">{pid}</a>
        <ChevronRight className="size-3" />
        <span>编辑</span>
      </div>

      <div className="flex gap-6">
        {/* Left: main form */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">编辑题目</h1>
            {!isCreate && (
              <div className="flex items-center gap-2">
                {downloadError && <span className="text-xs text-destructive">{downloadError}</span>}
                <Button type="button" size="sm" variant="outline" onClick={handleDownloadPackage} disabled={downloading}>
                  <Download className="mr-1 size-3.5" />
                  {downloading ? '打包中…' : '打包下载'}
                </Button>
              </div>
            )}
          </div>

          <form ref={formRef} method="post" onSubmit={handleSave} className="space-y-4">
            {/* Title + PID row */}
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-title">标题</label>
                    <Input
                      id="edit-title"
                      name="title"
                      defaultValue={pdoc.title || ''}
                      placeholder="题目标题"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-pid">题目编号</label>
                    <Input
                      id="edit-pid"
                      name="pid"
                      defaultValue={typeof pid === 'string' ? pid : ''}
                      placeholder="如 P1001"
                      pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
                    />
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-tag">
                    <Tag className="mr-1 inline-block size-3.5" />
                    标签
                  </label>
                  <Input
                    id="edit-tag"
                    name="tag"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="用逗号分隔，如：模拟, 数学, 贪心"
                  />
                  {tagInput && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {tagInput.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Difficulty + Hidden */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor="edit-difficulty">难度</label>
                    <SimpleSelect
                      id="edit-difficulty"
                      name="difficulty"
                      defaultValue={String(pdoc.difficulty || '')}
                      options={DIFFICULTY_OPTIONS.map((opt) => ({
                        value: String(opt.value),
                        label: opt.label,
                      }))}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 pb-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <Checkbox
                        name="hidden"
                        defaultChecked={!!pdoc.hidden}
                       />
                      <span className="flex items-center gap-1 text-sm">
                        {pdoc.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        隐藏题目
                      </span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <Checkbox
                        name="lockHidden"
                        defaultChecked={!!(pdoc as any).lockHidden}
                       />
                      <span className="flex items-center gap-1 text-sm">
                        <Lock className="size-3.5" />
                        锁定隐藏（比赛结束后不自动公开）
                      </span>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Content editor */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="size-4" />
                  题面内容
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <MarkdownEditor
                  name="content"
                  value={contentValue}
                  onChange={setDraftContent}
                  minHeight={400}
                  pasteUpload={filesBase ? {
                    endpoint: filesBase,
                    meta: { type: 'additional_file' },
                    makeUrl: (filename) => `file://${filename}`,
                  } : undefined}
                  previewFileUrl={(filename, original) => {
                    const queryIndex = original.indexOf('?');
                    const query = queryIndex >= 0 ? original.slice(queryIndex) : '';
                    return `${problemUrl}/file/${encodeURIComponent(filename)}${query}`;
                  }}
                />
              </CardContent>
            </Card>

            {/* Type picker (visible in both create + edit) */}
            <TypePicker value={typeState.type} onChange={setType} />

            {/* Type-specific editor — only when we have a pid to attach config.yaml to */}
            {!isCreate && typeState.type === 'objective' && (
              <ObjectiveEditor
                questions={typeState.objective}
                onChange={(next) => setTypeState((prev) => ({ ...prev, objective: next }))}
              />
            )}
            {!isCreate && typeState.type === 'fill_function' && (
              <FillFunctionEditor
                template={typeState.template}
                onChange={(t) => setTypeState((prev) => ({ ...prev, template: t }))}
              />
            )}
            {!isCreate && typeState.type === 'submit_answer' && (
              <SubmitAnswerEditor
                expectedAnswer={typeState.expectedAnswer}
                onChange={(t) => setTypeState((prev) => ({ ...prev, expectedAnswer: t }))}
              />
            )}
            {!isCreate && typeState.type === 'interactive' && (
              <InteractiveEditor
                interactor={typeState.interactor}
                onChange={(t) => setTypeState((prev) => ({ ...prev, interactor: t }))}
              />
            )}
            {!isCreate && typeState.type === 'communication' && (
              <CommunicationEditor
                manager={typeState.manager}
                onChange={(t) => setTypeState((prev) => ({ ...prev, manager: t }))}
              />
            )}
            {isCreate && typeState.type !== 'default' && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="p-3 text-xs text-amber-700 dark:text-amber-300">
                  题目类型的可视化字段（选项、答案、模板代码）将在创建后于编辑页填写。
                </CardContent>
              </Card>
            )}

            {/* Submit / Delete */}
            <div className="flex items-center justify-between">
              <div>
                {!showDeleteConfirm ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    删除题目
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-destructive">确定删除？所有文件、提交和讨论都将被删除。</span>
                    <Button
                      type="submit"
                      name="operation"
                      value="delete"
                      variant="destructive"
                      size="sm"
                    >
                      确认删除
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </div>
              <Button type="submit" className="gap-1.5">
                <Save className="size-3.5" />
                保存修改
              </Button>
            </div>
          </form>

          {/* Permits panel — out of the main form so its own POSTs don't
              compete with the problem-edit submit. Only meaningful when
              the problem is hidden. */}
          <PermitsPanel pid={String(pid)} pdocId={pdoc.docId} hidden={!!pdoc.hidden} />
        </div>

        {/* Right sidebar */}
        <div className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 space-y-6">
            <ProblemSidebar pid={String(pid)} problemUrl={problemUrl} active="edit" />
            <div className="border-t pt-4">
              <AdditionalFilesSidebar files={additionalFiles} problemUrl={problemUrl} />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
