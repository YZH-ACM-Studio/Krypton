/**
 * Problem edit page — form for editing problem title, content, tags,
 * difficulty, visibility, PID, with sidebar navigation and delete.
 */

import { AlertCircle, CheckCircle2, Download, Eye, EyeOff, FileText, Loader2, Lock, Save, Tag, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemEditorWorkspace } from '@/components/problem-editor-workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { downloadProblemPackage } from '@/lib/problem-package';
import { managedSourceFieldViews, managedSourceTagPreview, type ManagedSourceTemplateOption } from '@/lib/managed-problem-source';

type R = Record<string, any>;

interface ManagedMindmapOption {
  id: string;
  label: string;
  tags: string[];
}

interface ManagedTrainingOption {
  id: string;
  title: string;
  templates: string[];
  chapters: Array<{ id: number; title: string }>;
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

/* ---------- Permits panel ---------- */

interface PermitRow {
  _id: string;
  pid: number;
  uid: number;
  role: 'verifier' | 'author' | 'maintainer';
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

type PermitRole = PermitRow['role'];

const PERMIT_ROLE_LABELS: Record<PermitRole, string> = {
  verifier: '验题人',
  author: '出题人',
  maintainer: '维护者',
};

function PermitsPanel({ pid, pdocId, hidden, managed }: { pid: string; pdocId: number; hidden: boolean; managed: boolean }) {
  const bs = useBootstrap();
  const [permits, setPermits] = useState<PermitRow[]>([]);
  const [udict, setUdict] = useState<Record<string, { _id: number; uname: string }>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [grantableRoles, setGrantableRoles] = useState<PermitRole[]>([]);
  const [canManageMaintainers, setCanManageMaintainers] = useState(false);
  const [selectedRole, setSelectedRole] = useState<PermitRole>('verifier');
  const apiPid = String(pdocId || pid);

  const refresh = useCallback(async () => {
    setLoadError('');
    try {
      const r = await fetch(`/p/${apiPid}/permits`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`权限列表加载失败：HTTP ${r.status}`);
      const j = await r.json();
      if (!Array.isArray(j?.permits)) throw new Error('权限列表响应格式错误');
      setPermits(j.permits || []);
      setUdict(j.udict || {});
      const roles: PermitRole[] = Array.isArray(j.grantableRoles)
        ? j.grantableRoles.filter((role: unknown): role is PermitRole => typeof role === 'string' && role in PERMIT_ROLE_LABELS)
        : [];
      setGrantableRoles(roles);
      setCanManageMaintainers(j.canManageMaintainers === true);
      setSelectedRole((current) => (roles.includes(current) ? current : roles[0] || 'verifier'));
      setLoaded(true);
    } catch (error) {
      console.error('Failed to load problem permits', error);
      setLoadError(error instanceof Error ? error.message : '权限列表加载失败');
      setLoaded(true);
    }
  }, [apiPid]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const searchUsers = useCallback(
    async (query: string): Promise<UserOption[]> => {
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
    },
    [bs.domain?.id],
  );

  async function revoke(permitId: string) {
    if (!confirm('确定撤销该权限？')) return;
    const fd = new FormData();
    fd.set('permitId', permitId);
    const r = await fetch(`/p/${apiPid}/permits/revoke`, { method: 'POST', body: fd, credentials: 'include' });
    if (!r.ok) {
      setLoadError(`撤销权限失败：HTTP ${r.status}`);
      return;
    }
    refresh();
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
          <span>出题协作</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={!loaded || !grantableRoles.length || (!hidden && !managed)}
          >
            添加协作者
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hidden && !managed ? (
          <p className="text-xs text-muted-foreground">题目当前不是隐藏状态，无需邀请验题人。把题目设为「隐藏」并保存后即可邀请。</p>
        ) : loadError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {loadError}
          </p>
        ) : !loaded ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : permits.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有协作者</p>
        ) : (
          <ul className="divide-y">
            {permits.map((p) => (
              <li key={p._id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{udict[p.uid]?.uname || `uid:${p.uid}`}</span>
                    <Badge variant={p.role === 'maintainer' ? 'default' : 'secondary'} className="text-[10px]">
                      {PERMIT_ROLE_LABELS[p.role]}
                    </Badge>
                    {p.viaContest ? (
                      <Badge variant="outline" className="text-[10px]">
                        通过比赛邀请
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    由 {udict[p.grantedBy]?.uname || `uid:${p.grantedBy}`} 邀请于 {new Date(p.grantedAt).toLocaleString('zh-CN')}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                {p.role !== 'maintainer' || canManageMaintainers ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => revoke(p._id)}>
                    撤销
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setInviteError('');
        }}
      >
        <DialogContent className="w-full overflow-visible sm:w-[560px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>添加题目协作者</DialogTitle>
          </DialogHeader>
          <form method="post" action={`/p/${apiPid}/permits`} className="space-y-4 p-5" onSubmit={submitInvite}>
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
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="permit-role">
                角色
              </label>
              <SimpleSelect
                id="permit-role"
                name="role"
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(value as PermitRole)}
                options={grantableRoles.map((role) => ({ value: role, label: PERMIT_ROLE_LABELS[role] }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground" htmlFor="permit-note">
                附言（可选，会附在通知里）
              </label>
              <Input id="permit-note" name="note" placeholder="例：帮我测一下边界数据" />
            </div>
            {inviteError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{inviteError}</p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={inviteBusy}>
                取消
              </Button>
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
  const capabilities: R = data.problemAuthoringCapabilities || {};
  const isCreate = !pdoc.docId;
  const managedExisting = pdoc.authoringMode === 'managed' || capabilities.managed === true;
  const canChooseManagedCreate = isCreate && data.canCreateManagedProblem === true && !data.managedCreateDefault;
  const [managedCreateMode, setManagedCreateMode] = useState(data.managedCreateDefault === true);
  const managed = managedExisting || (isCreate && managedCreateMode);
  const pid = pdoc.pid || pdoc.docId || '';
  const problemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(pid) });
  const additionalFiles: R[] = data.additional_file || [];
  const testdataFiles: R[] = data.testdata || pdoc.data || [];
  const canEditDraftMetadata = !managed || capabilities.canEditDraftMetadata === true;
  const canEditCanonicalMetadata = !managed || capabilities.canPublish === true;
  const canPublish = !managed;
  const canDelete = !managed || capabilities.canDelete === true;
  const canManageCollaborators = !managed || capabilities.canManageCollaborators === true;
  const managedMetadataDraft = pdoc.managedAuthoring?.metadataStatus === 'draft';
  const canSubmitManagedWorkingTitle = isCreate || (managedMetadataDraft && canEditDraftMetadata);
  const filesBase = pdoc.docId ? `${problemUrl}/files` : '';

  const rawContent = pdoc.content || '';
  const contentValue =
    typeof rawContent === 'string' || (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent))
      ? rawContent
      : String(rawContent || '');
  const [draftContent, setDraftContent] = useState<string | R>(contentValue);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const editVersion = useRef(0);
  const allowNavigation = useRef(false);

  const tags: string[] = pdoc.tag || [];
  const [tagInput, setTagInput] = useState(tags.join(', '));
  const [hiddenValue, setHiddenValue] = useState(isCreate || !!pdoc.hidden);
  const [lockHiddenValue, setLockHiddenValue] = useState(!!pdoc.lockHidden);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const sourceTemplates: ManagedSourceTemplateOption[] = data.managedSourceTemplates || [];
  const mindmapOptions: ManagedMindmapOption[] = data.managedMindmapOptions || [];
  const trainingOptions: ManagedTrainingOption[] = data.managedTrainingOptions || [];
  const initialTemplate = pdoc.sourceMeta?.template || sourceTemplates[0]?.id || '';
  const [sourceTemplate, setSourceTemplate] = useState(initialTemplate);
  const [sourceYear, setSourceYear] = useState(String(pdoc.sourceMeta?.year || new Date().getFullYear()));
  const [sourceSeason, setSourceSeason] = useState(String(pdoc.sourceMeta?.season || 'spring'));
  const [sourceLevel, setSourceLevel] = useState(String(pdoc.sourceMeta?.level || 'L1'));
  const [sourceRound, setSourceRound] = useState(String(pdoc.sourceMeta?.round || 1));
  const initialMindmapIds = new Set((pdoc.managedAuthoring?.selectedMindmapNodeIds || []).map(String));
  const [selectedMindmapNodes, setSelectedMindmapNodes] = useState<ManagedMindmapOption[]>(
    mindmapOptions.filter((option) => initialMindmapIds.has(option.id)),
  );
  const [selectedTrainingId, setSelectedTrainingId] = useState(String(pdoc.managedAuthoring?.pendingTrainingPlacement?.trainingId || ''));
  const [selectedChapterId, setSelectedChapterId] = useState(String(pdoc.managedAuthoring?.pendingTrainingPlacement?.chapterId || ''));
  const selectedTemplateDefinition = sourceTemplates.find((template) => template.id === sourceTemplate);
  const persistedTemplateDefinition = sourceTemplates.find((template) => template.id === pdoc.sourceMeta?.template);
  const persistedSourceFields = managedSourceFieldViews(pdoc.sourceMeta, persistedTemplateDefinition);
  const eligibleTrainings = trainingOptions.filter((training) => training.templates.includes(sourceTemplate));
  const selectedTraining = eligibleTrainings.find((training) => training.id === selectedTrainingId);
  const sourcePreviewTags = managedSourceTagPreview(sourceTemplate, sourceYear, sourceSeason, sourceLevel);
  const managedTags = [
    ...new Set([...(isCreate ? sourcePreviewTags : pdoc.tag || []), ...(isCreate ? selectedMindmapNodes.flatMap((node) => node.tags) : [])]),
  ];

  useEffect(() => {
    if (!selectedTrainingId || eligibleTrainings.some((training) => training.id === selectedTrainingId)) return;
    setSelectedTrainingId('');
    setSelectedChapterId('');
  }, [eligibleTrainings, selectedTrainingId]);

  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if (allowNavigation.current || !['dirty', 'saving', 'error'].includes(saveState)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [saveState]);

  const markDirty = useCallback(() => {
    editVersion.current += 1;
    setSaveError('');
    setSaveState((current) => (current === 'saving' ? current : 'dirty'));
  }, []);

  const handleDownloadPackage = useCallback(async () => {
    if (isCreate || !problemUrl) return;
    setDownloading(true);
    setDownloadError('');
    try {
      const fd = formRef.current ? new FormData(formRef.current) : null;
      const packagePdoc = fd
        ? {
            ...pdoc,
            pid: String(fd.get('pid') || pdoc.pid || ''),
            title: String(fd.get('title') || pdoc.title || ''),
            tag: fd.has('tag')
              ? String(fd.get('tag') || '')
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean)
              : pdoc.tag || [],
            difficulty: Number(fd.get('difficulty') || pdoc.difficulty || 0),
          }
        : pdoc;
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

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (isCreate || submitter?.value === 'delete') {
      allowNavigation.current = true;
      setSaveState('saving');
      return;
    }
    e.preventDefault();
    setSaveError('');
    setSaveState('saving');
    const form = e.currentTarget;
    const fd = new FormData(form);
    const savedVersion = editVersion.current;
    try {
      const editRes = await fetch(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(fd as any),
        headers: { Accept: 'application/json' },
      });
      if (!editRes.ok) {
        let message = editRes.status === 409 ? '题目已被其他操作修改或锁定，请刷新后重试。' : `保存失败：HTTP ${editRes.status}`;
        try {
          const body = await editRes.json();
          const serverMessage = body?.error?.message || body?.message || body?.error;
          if (typeof serverMessage === 'string') message = serverMessage;
        } catch {
          const body = await editRes.text().catch(() => '');
          if (body) message = body.slice(0, 180);
        }
        throw new Error(message);
      }
      if (editVersion.current === savedVersion) {
        allowNavigation.current = true;
        setSaveState('saved');
        window.location.assign(problemUrl);
      } else {
        setSaveState('dirty');
      }
    } catch (error) {
      console.error('Failed to save programming problem metadata', error);
      setSaveError(error instanceof Error ? error.message : '保存失败');
      setSaveState('error');
    }
  };

  const status = (
    <span aria-live="polite" className="inline-flex min-h-9 items-center gap-1.5 text-xs text-muted-foreground">
      {saveState === 'saving' ? (
        <>
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          保存中
        </>
      ) : null}
      {saveState === 'dirty' ? (
        <>
          <span className="size-1.5 rounded-full bg-amber-500" />
          有未保存修改
        </>
      ) : null}
      {saveState === 'saved' ? (
        <>
          <CheckCircle2 className="size-3.5 text-emerald-600" />
          已保存
        </>
      ) : null}
      {saveState === 'error' ? (
        <>
          <AlertCircle className="size-3.5 text-destructive" />
          保存失败
        </>
      ) : null}
      {saveState === 'idle' && !isCreate ? '已载入服务器版本' : null}
    </span>
  );

  const actions = (
    <>
      {!isCreate ? (
        <Button type="button" size="sm" variant="outline" onClick={handleDownloadPackage} disabled={downloading}>
          <Download className="mr-1 size-3.5" />
          {downloading ? '打包中…' : '打包下载'}
        </Button>
      ) : null}
      <Button type="submit" form="programming-problem-form" size="sm" className="gap-1.5" disabled={saveState === 'saving'}>
        {saveState === 'saving' ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <Save className="size-3.5" />}
        {isCreate ? '创建题目' : '保存修改'}
      </Button>
    </>
  );

  return (
    <ProblemEditorWorkspace
      page="edit"
      problemUrl={problemUrl}
      title={pdoc.title || '新建编程题'}
      pid={String(pid)}
      isCreate={isCreate}
      status={status}
      actions={actions}
    >
      <div className="space-y-6">
        {downloadError ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            打包下载失败：{downloadError}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {saveError}
          </p>
        ) : null}

        <form id="programming-problem-form" ref={formRef} method="post" onSubmit={handleSave} onChange={markDirty} className="space-y-6">
          {!isCreate && pdoc.problemKind && pdoc.structureRevision ? (
            <input type="hidden" name="expectedStructureRevision" value={String(pdoc.structureRevision)} />
          ) : null}
          {isCreate && managed ? <input type="hidden" name="managed" value="true" /> : null}

          {canChooseManagedCreate ? (
            <section className="rounded-2xl border border-border/70 bg-card/30 p-5">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox checked={managedCreateMode} onCheckedChange={setManagedCreateMode} aria-label="创建托管题" />
                <span>
                  <span className="block text-sm font-semibold">创建托管题并指定出题人</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    PID、来源标签和算法标签由服务端生成；关闭后保留管理员原有的完整创建方式。
                  </span>
                </span>
              </label>
            </section>
          ) : null}

          <section id="basic" aria-labelledby="basic-heading" className="scroll-mt-44 rounded-2xl border border-border/70 bg-card/30">
            <header className="border-b border-border/60 px-5 py-4">
              <h2 id="basic-heading" className="text-base font-semibold tracking-tight">
                基本信息
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">设置题目在题库中的识别信息，不影响评测数据。</p>
            </header>
            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-title">
                    {managed ? (isCreate || managedMetadataDraft ? '工作标题' : '正式标题') : '标题'}
                  </label>
                  <Input
                    id="edit-title"
                    name={!managed || canSubmitManagedWorkingTitle ? 'title' : undefined}
                    defaultValue={
                      managed && !isCreate
                        ? managedMetadataDraft
                          ? pdoc.managedAuthoring?.workingTitle || ''
                          : pdoc.title || ''
                        : pdoc.title || ''
                    }
                    placeholder={managed ? '用于审核协作，不会直接作为正式标题发布' : '题目标题'}
                    readOnly={managed ? !canSubmitManagedWorkingTitle : !isCreate && !canEditDraftMetadata}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-pid">
                    题目编号
                  </label>
                  <Input
                    id="edit-pid"
                    name={managed ? undefined : 'pid'}
                    defaultValue={typeof pid === 'string' ? pid : ''}
                    placeholder={managed ? '由服务端分配' : '如 P1001'}
                    pattern="^(?:[a-z0-9]{1,10}-)?[a-zA-Z][a-zA-Z0-9]*$"
                    readOnly={managed}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-tag">
                    <Tag className="mr-1 inline-block size-3.5" />
                    标签
                  </label>
                  <Input
                    id="edit-tag"
                    name={managed ? undefined : 'tag'}
                    value={managed ? managedTags.join(', ') : tagInput}
                    onChange={(event) => {
                      if (canEditCanonicalMetadata) setTagInput(event.target.value);
                    }}
                    placeholder={managed ? '托管题标签由审核流程确定' : '用逗号分隔，如：模拟, 数学, 贪心'}
                    readOnly={managed}
                  />
                  {(managed ? managedTags.length : tagInput) ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {(managed
                        ? managedTags
                        : tagInput
                            .split(',')
                            .map((tag) => tag.trim())
                            .filter(Boolean)
                      ).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="edit-difficulty">
                    难度
                  </label>
                  {managed && !isCreate && !canEditDraftMetadata ? (
                    <Input
                      id="edit-difficulty"
                      value={DIFFICULTY_OPTIONS.find((option) => Number(option.value) === Number(pdoc.difficulty || 0))?.label || '未评定'}
                      readOnly
                    />
                  ) : (
                    <SimpleSelect
                      id="edit-difficulty"
                      name="difficulty"
                      defaultValue={String(pdoc.difficulty || '')}
                      options={DIFFICULTY_OPTIONS.filter((option) => !managed || option.value !== '').map((option) => ({
                        value: String(option.value),
                        label: option.label,
                      }))}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          {managed ? (
            <section id="managed-source" aria-labelledby="managed-source-heading" className="rounded-2xl border border-border/70 bg-card/30">
              <header className="border-b border-border/60 px-5 py-4">
                <h2 id="managed-source-heading" className="text-base font-semibold tracking-tight">
                  来源与归档
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isCreate
                    ? '选择固定来源和知识导图节点；PID 与标签仅由服务端计算。训练选择只记录待审核位置。'
                    : '来源、PID 与系统标签已锁定；最终发布由管理员审核。'}
                </p>
              </header>
              {isCreate ? (
                <div className="space-y-5 p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="managed-template">
                        来源模板
                      </label>
                      <SimpleSelect
                        id="managed-template"
                        name="template"
                        value={sourceTemplate}
                        onValueChange={(value) => {
                          setSourceTemplate(value);
                          setSelectedTrainingId('');
                          setSelectedChapterId('');
                        }}
                        options={sourceTemplates.map((template) => ({ value: template.id, label: template.label }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="managed-year">
                        年份
                      </label>
                      <Input
                        id="managed-year"
                        name="year"
                        type="number"
                        min={2000}
                        max={2100}
                        value={sourceYear}
                        onChange={(event) => setSourceYear(event.target.value)}
                        required
                      />
                    </div>
                    {selectedTemplateDefinition?.fields.includes('season') ? (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="managed-season">
                          季度
                        </label>
                        <SimpleSelect
                          id="managed-season"
                          name="season"
                          value={sourceSeason}
                          onValueChange={setSourceSeason}
                          options={[
                            { value: 'spring', label: '春季' },
                            { value: 'autumn', label: '秋季' },
                          ]}
                        />
                      </div>
                    ) : null}
                    {selectedTemplateDefinition?.fields.includes('level') ? (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="managed-level">
                          题目等级
                        </label>
                        <SimpleSelect
                          id="managed-level"
                          name="level"
                          value={sourceLevel}
                          onValueChange={setSourceLevel}
                          options={['L1', 'L2', 'L3'].map((value) => ({ value, label: value }))}
                        />
                      </div>
                    ) : null}
                    {selectedTemplateDefinition?.fields.includes('round') ? (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="managed-round">
                          场次
                        </label>
                        <Input
                          id="managed-round"
                          name="round"
                          type="number"
                          min={1}
                          max={99}
                          value={sourceRound}
                          onChange={(event) => setSourceRound(event.target.value)}
                          required
                        />
                        <p className="text-xs text-muted-foreground">场次只进入来源元数据和训练章节，不生成标签。</p>
                      </div>
                    ) : null}
                    {canChooseManagedCreate ? (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium" htmlFor="managed-author-uid">
                          出题人 UID
                        </label>
                        <Input id="managed-author-uid" name="authorUid" type="number" min={1} required />
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">算法知识点</label>
                    <MultiSelect
                      options={mindmapOptions}
                      value={selectedMindmapNodes}
                      onChange={setSelectedMindmapNodes}
                      getKey={(node) => node.id}
                      getLabel={(node) => node.label}
                      getDescription={(node) => node.tags.join(' / ')}
                      name="mindmapNodeIds"
                      placeholder="从知识导图选择，可多选"
                      emptyText="没有可选的带标签节点"
                    />
                    <p className="text-xs text-muted-foreground">服务端会同时物化每个节点路径上所有带标签的祖先。</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="managed-training">
                        待挂训练（可选）
                      </label>
                      <SimpleSelect
                        id="managed-training"
                        name="trainingId"
                        value={selectedTrainingId}
                        onValueChange={(value) => {
                          setSelectedTrainingId(value);
                          setSelectedChapterId('');
                        }}
                        options={[
                          { value: '', label: '暂不加入训练' },
                          ...eligibleTrainings.map((training) => ({ value: training.id, label: training.title })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor="managed-chapter">
                        现有章节
                      </label>
                      <SimpleSelect
                        id="managed-chapter"
                        name={selectedTrainingId ? 'chapterId' : undefined}
                        value={selectedChapterId}
                        onValueChange={setSelectedChapterId}
                        disabled={!selectedTraining}
                        options={[
                          { value: '', label: selectedTraining ? '请选择章节' : '先选择训练' },
                          ...(selectedTraining?.chapters || []).map((chapter) => ({ value: String(chapter.id), label: chapter.title })),
                        ]}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl bg-muted/45 px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground">服务端将生成的来源标签</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sourcePreviewTags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <div className="grid gap-3 rounded-xl bg-muted/45 px-4 py-3 sm:grid-cols-2">
                    {persistedSourceFields.map((field) => (
                      <div key={field.label}>
                        <p className="text-xs text-muted-foreground">{field.label}</p>
                        <p className="mt-1 text-sm font-medium">{field.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl bg-muted/45 px-4 py-3">
                    <p className="text-xs text-muted-foreground">待挂训练</p>
                    <p className="mt-1 text-sm font-medium">
                      {pdoc.managedAuthoring?.pendingTrainingPlacement
                        ? `${trainingOptions.find((training) => training.id === String(pdoc.managedAuthoring.pendingTrainingPlacement.trainingId))?.title || '训练'} / ${
                            trainingOptions
                              .flatMap((training) => training.chapters)
                              .find((chapter) => chapter.id === pdoc.managedAuthoring.pendingTrainingPlacement.chapterId)?.title ||
                            `章节 ${pdoc.managedAuthoring.pendingTrainingPlacement.chapterId}`
                          }`
                        : '未选择'}
                    </p>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section id="statement" aria-labelledby="statement-heading" className="scroll-mt-44 rounded-2xl border border-border/70 bg-card/30">
            <header className="flex items-start gap-3 border-b border-border/60 px-5 py-4">
              <FileText className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 id="statement-heading" className="text-base font-semibold tracking-tight">
                  题面
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Markdown 内容；粘贴图片继续使用现有附加文件 API。</p>
              </div>
            </header>
            <div className="p-5">
              <MarkdownEditor
                name="content"
                value={draftContent}
                onChange={(value) => {
                  setDraftContent(value);
                  markDirty();
                }}
                minHeight={440}
                pasteUpload={
                  filesBase
                    ? {
                        endpoint: filesBase,
                        meta: { type: 'additional_file' },
                        makeUrl: (filename) => `file://${filename}`,
                      }
                    : undefined
                }
                previewFileUrl={(filename, original) => {
                  const queryIndex = original.indexOf('?');
                  const query = queryIndex >= 0 ? original.slice(queryIndex) : '';
                  return `${problemUrl}/file/${encodeURIComponent(filename)}${query}`;
                }}
              />
            </div>
          </section>

          <section id="permissions" aria-labelledby="permissions-heading" className="scroll-mt-44 rounded-2xl border border-border/70 bg-card/30">
            <header className="border-b border-border/60 px-5 py-4">
              <h2 id="permissions-heading" className="text-base font-semibold tracking-tight">
                权限与可见性
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {managed ? '托管草稿保持隐藏；管理员从统一题库确认元数据并发布。' : '新题固定以隐藏状态创建；发布与维护权限沿用现有模型。'}
              </p>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {!isCreate && canPublish ? <input type="hidden" name="hidden" value={hiddenValue ? 'true' : 'false'} /> : null}
              {!isCreate && canPublish ? <input type="hidden" name="lockHidden" value={lockHiddenValue ? 'true' : 'false'} /> : null}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-muted/45 px-3">
                <Checkbox checked={hiddenValue} disabled={isCreate || !canPublish} onCheckedChange={setHiddenValue} aria-label="隐藏题目" />
                <span className="flex items-center gap-1.5 text-sm">
                  {hiddenValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {isCreate ? '创建后保持隐藏' : '隐藏题目'}
                </span>
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-muted/45 px-3">
                <Checkbox
                  checked={lockHiddenValue}
                  disabled={isCreate || (managed && !canPublish)}
                  onCheckedChange={setLockHiddenValue}
                  aria-label="锁定隐藏"
                />
                <span className="flex items-center gap-1.5 text-sm">
                  <Lock className="size-3.5" />
                  锁定隐藏（比赛结束后不自动公开）
                </span>
              </label>
            </div>
          </section>

          {!isCreate && canDelete ? (
            <section aria-labelledby="danger-heading" className="rounded-2xl border border-destructive/25 bg-destructive/[0.025] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 id="danger-heading" className="text-sm font-semibold text-destructive">
                    危险操作
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">删除将同时移除题目文件、提交记录和讨论。</p>
                </div>
                {!showDeleteConfirm ? (
                  <Button type="button" variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                    <Trash2 className="mr-1 size-3.5" />
                    删除题目
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-destructive">确认永久删除？</span>
                    <Button type="submit" name="operation" value="delete" variant="destructive" size="sm">
                      确认删除
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                      取消
                    </Button>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </form>

        {!isCreate && canManageCollaborators ? (
          <div id="maintainers" className="scroll-mt-44">
            <PermitsPanel pid={String(pid)} pdocId={pdoc.docId} hidden={!!pdoc.hidden} managed={managed} />
          </div>
        ) : null}
      </div>
    </ProblemEditorWorkspace>
  );
}
