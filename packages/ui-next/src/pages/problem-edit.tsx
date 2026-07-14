/**
 * Problem edit page — form for editing problem title, content, tags,
 * difficulty, visibility, PID, with sidebar navigation and delete.
 */

import { AlertCircle, ArrowRight, CheckCircle2, Download, Eye, EyeOff, FileText, Loader2, Lock, Save, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemEditorWorkspace } from '@/components/problem-editor-workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

async function responseErrorMessage(response: Response, fallback: string) {
  const raw = await response.text().catch(() => '');
  if (raw) {
    try {
      const body = JSON.parse(raw);
      const message = body?.error?.message || body?.message || body?.error;
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      const text = raw.trim();
      if (text && !text.startsWith('<!DOCTYPE') && !text.startsWith('<html')) return text.slice(0, 180);
    }
  }
  return `${fallback}：HTTP ${response.status}`;
}

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

async function loadDomainUsers(domainId: string, query: string): Promise<UserOption[]> {
  const search = query.trim();
  if (!search) return [];
  const response = await fetch(`/d/${encodeURIComponent(domainId)}/api/users`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args: { search, limit: 10, exact: false },
      projection: ['_id', 'uname', 'mail', 'avatarUrl'],
    }),
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response, '用户搜索失败'));
  const users = await response.json();
  if (!Array.isArray(users) || users.some((item) => !Number.isSafeInteger(item?._id) || item._id <= 0)) {
    throw new Error('用户搜索响应格式错误');
  }
  return users;
}

function userSearchLabel(user: UserOption) {
  return `${user.uname || `uid:${user._id}`} ${user._id} ${user.mail || ''}`;
}

function UserSearchOption({ user }: { user: UserOption }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-medium">
        {user.uname || `uid:${user._id}`}
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">UID {user._id}</span>
      </span>
      {user.mail ? <span className="truncate text-[11px] text-muted-foreground">{user.mail}</span> : null}
    </span>
  );
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
    setLoaded(false);
    try {
      const r = await fetch(`/p/${apiPid}/permits`, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(await responseErrorMessage(r, '权限列表加载失败'));
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
      setInviteError('');
      try {
        return await loadDomainUsers(bs.domain?.id || 'system', query);
      } catch (error) {
        console.error('Failed to search problem collaborators', error);
        setInviteError(error instanceof Error ? error.message : '用户搜索失败');
        throw error;
      }
    },
    [bs.domain?.id],
  );

  async function revoke(permitId: string) {
    if (!confirm('确定撤销该权限？')) return;
    setLoadError('');
    const fd = new FormData();
    fd.set('permitId', permitId);
    try {
      const r = await fetch(`/p/${apiPid}/permits/revoke`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        setLoadError(await responseErrorMessage(r, '撤销权限失败'));
        return;
      }
      await refresh();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '撤销权限失败');
    }
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
        setInviteError(await responseErrorMessage(r, '发送邀请失败'));
        return;
      }
      setSelectedUsers([]);
      setOpen(false);
      await refresh();
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : '发送邀请失败');
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <section aria-labelledby="collaboration-heading" className="rounded-2xl border border-border/70 bg-card/30">
      <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="collaboration-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            出题协作
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">管理出题人、验题人与维护者；所有变更仍由服务端能力校验。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" size="sm" variant="ghost">
            <a href="/permits/inbox">我的验题任务</a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            disabled={!loaded || !grantableRoles.length || (!hidden && !managed)}
          >
            添加协作者
          </Button>
        </div>
      </header>
      <div className="space-y-2 p-5">
        {!hidden && !managed ? (
          <p className="text-xs text-muted-foreground">题目当前不是隐藏状态，无需邀请验题人。把题目设为「隐藏」并保存后即可邀请。</p>
        ) : null}
        {loadError ? (
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
      </div>

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
                getLabel={userSearchLabel}
                renderChip={(u) => (
                  <span className="inline-flex items-center gap-1">
                    <span className="font-medium">{u.uname || `uid:${u._id}`}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">#{u._id}</span>
                  </span>
                )}
                renderOption={(u) => <UserSearchOption user={u} />}
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
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {inviteError}
              </p>
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
    </section>
  );
}

function ManagedReviewPanel({
  pdoc,
  sourceTemplates,
  trainingOptions,
  problemsUrl,
}: {
  pdoc: R;
  sourceTemplates: ManagedSourceTemplateOption[];
  trainingOptions: ManagedTrainingOption[];
  problemsUrl: string;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const template = sourceTemplates.find((item) => item.id === pdoc.sourceMeta?.template);
  const sourceFields = managedSourceFieldViews(pdoc.sourceMeta, template);
  const pendingPlacement = pdoc.managedAuthoring?.pendingTrainingPlacement;
  const pendingTraining = trainingOptions.find((training) => training.id === String(pendingPlacement?.trainingId || ''));
  const pendingChapter = pendingTraining?.chapters.find((chapter) => chapter.id === pendingPlacement?.chapterId);
  const metadataDraft = pdoc.managedAuthoring?.metadataStatus === 'draft';

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReviewError('');
    setReviewing(true);
    try {
      const response = await fetch(problemsUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(event.currentTarget) as any),
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response, '审核发布失败'));
      const body = await response.json();
      if (typeof body?.url !== 'string' || !body.url) throw new Error('审核发布响应缺少跳转地址');
      window.location.assign(body.url);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '审核发布失败');
      setReviewing(false);
    }
  };

  return (
    <section aria-labelledby="managed-review-heading" className="rounded-2xl border border-primary/25 bg-primary/[0.025]">
      <header className="border-b border-primary/15 px-5 py-4">
        <h2 id="managed-review-heading" className="text-base font-semibold tracking-tight">
          管理员审核与发布
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">确认正式标题、来源、标签和待挂训练后，通过既有统一发布服务公开题目。</p>
      </header>
      <div className="space-y-5 p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">工作标题</dt>
            <dd className="mt-1 font-medium">{pdoc.managedAuthoring?.workingTitle || '—'}</dd>
          </div>
          {sourceFields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="mt-1 font-medium">{field.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">待挂训练</dt>
            <dd className="mt-1 font-medium">
              {pendingPlacement
                ? `${pendingTraining?.title || '训练已失效'} / ${pendingChapter?.title || `章节 ${pendingPlacement.chapterId}`}`
                : '不挂入训练'}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-xs text-muted-foreground">最终标签</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(pdoc.tag || []).map((tag: string) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        {pdoc.hidden ? (
          <form
            method="post"
            action={problemsUrl}
            className="grid gap-4 border-t border-primary/15 pt-5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
            onSubmit={submitReview}
          >
            <input type="hidden" name="operation" value="managedPublish" />
            <input type="hidden" name="pid" value={String(pdoc.docId)} />
            <label className="space-y-1.5">
              <span className="text-sm font-medium">正式标题</span>
              <Input
                name="formalTitle"
                defaultValue={metadataDraft ? pdoc.managedAuthoring?.workingTitle || '' : pdoc.title || pdoc.managedAuthoring?.workingTitle || ''}
                required
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">难度</span>
              <SimpleSelect
                name="difficulty"
                defaultValue={String(pdoc.difficulty ?? 0)}
                options={DIFFICULTY_OPTIONS.map((option) => ({ value: String(option.value || 0), label: option.label }))}
              />
            </label>
            <Button type="submit" className="min-h-11" disabled={reviewing}>
              {reviewing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {metadataDraft ? '确认并发布' : '重新公开'}
            </Button>
            {reviewError ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:col-span-3">
                {reviewError}
              </p>
            ) : null}
          </form>
        ) : (
          <p role="status" className="border-t border-primary/15 pt-4 text-sm text-muted-foreground">
            此题已经发布；如因生命周期操作重新隐藏，仍需从本区走统一重新公开流程。
          </p>
        )}
      </div>
    </section>
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
  const canReviewManaged = managed && !isCreate && capabilities.canPublish === true;
  const collaborationEnabled = !isCreate && (canManageCollaborators || canReviewManaged);
  const requestedSection = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('section');
  const showCollaboration = requestedSection === 'collaboration' && collaborationEnabled;
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
  const [selectedManagedAuthors, setSelectedManagedAuthors] = useState<UserOption[]>([]);
  const [managedAuthorSearchError, setManagedAuthorSearchError] = useState('');
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

  const searchManagedAuthors = useCallback(
    async (query: string): Promise<UserOption[]> => {
      setManagedAuthorSearchError('');
      try {
        return await loadDomainUsers(bs.domain?.id || 'system', query);
      } catch (error) {
        console.error('Failed to search managed problem authors', error);
        setManagedAuthorSearchError(error instanceof Error ? error.message : '用户搜索失败');
        throw error;
      }
    },
    [bs.domain?.id],
  );

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
    if (submitter?.value === 'delete') {
      allowNavigation.current = true;
      setSaveState('saving');
      return;
    }
    e.preventDefault();
    setSaveError('');
    if (managed && isCreate && canChooseManagedCreate && selectedManagedAuthors.length !== 1) {
      const message = '请选择一名出题人。';
      setManagedAuthorSearchError(message);
      setSaveError(message);
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    const form = e.currentTarget;
    const fd = new FormData(form);
    const savedVersion = editVersion.current;
    try {
      const editRes = await fetch(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(fd as any),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!editRes.ok) {
        throw new Error(await responseErrorMessage(editRes, editRes.status === 409 ? '题目已被其他操作修改或锁定，请刷新后重试' : '保存失败'));
      }
      if (isCreate) {
        const body = await editRes.json();
        if (body?.pid === undefined || body?.pid === null || body.pid === '') throw new Error('创建响应缺少真实题号');
        const createdProblemUrl = replaceRouteTokens(bs.urls.problemDetail, { PID: String(body.pid) });
        allowNavigation.current = true;
        setSaveState('saved');
        window.location.assign(`${createdProblemUrl}/edit`);
        return;
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
      page={showCollaboration ? 'collaboration' : 'edit'}
      problemUrl={problemUrl}
      title={(managed && pdoc.managedAuthoring?.workingTitle) || pdoc.title || '新建编程题'}
      pid={String(pid)}
      isCreate={isCreate}
      collaborationEnabled={collaborationEnabled}
      status={showCollaboration ? undefined : status}
      actions={showCollaboration ? undefined : actions}
    >
      {showCollaboration ? (
        <div className="space-y-6">
          {canManageCollaborators ? <PermitsPanel pid={String(pid)} pdocId={pdoc.docId} hidden={!!pdoc.hidden} managed={managed} /> : null}
          {canReviewManaged ? (
            <ManagedReviewPanel pdoc={pdoc} sourceTemplates={sourceTemplates} trainingOptions={trainingOptions} problemsUrl={bs.urls.problems} />
          ) : null}
        </div>
      ) : (
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

            <section aria-labelledby="problem-content-heading" className="overflow-hidden rounded-2xl border border-border/70 bg-card/30">
              <header className="border-b border-border/60 px-5 py-4">
                <h2 id="problem-content-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                  题目内容
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">标题、题号、标签、来源、可见性与题面由同一表单一次保存。</p>
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

              {managed ? (
                <div className="border-t border-border/60">
                  <header className="px-5 py-4">
                    <h3 className="text-sm font-semibold tracking-tight">来源与归档</h3>
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
                                { value: 'summer', label: '夏季' },
                                { value: 'autumn', label: '秋季' },
                                { value: 'winter', label: '冬季' },
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
                          <div className="space-y-1.5" role="group" aria-labelledby="managed-author-label">
                            <span id="managed-author-label" className="text-sm font-medium">
                              出题人
                            </span>
                            <MultiSelect<UserOption>
                              value={selectedManagedAuthors}
                              onChange={(next) => {
                                setSelectedManagedAuthors(next);
                                setManagedAuthorSearchError('');
                                markDirty();
                              }}
                              loadOptions={searchManagedAuthors}
                              getKey={(user) => String(user._id)}
                              getLabel={userSearchLabel}
                              renderChip={(user) => (
                                <span className="inline-flex items-center gap-1">
                                  <span className="font-medium">{user.uname || `uid:${user._id}`}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">#{user._id}</span>
                                </span>
                              )}
                              renderOption={(user) => <UserSearchOption user={user} />}
                              name="authorUid"
                              maxItems={1}
                              placeholder="输入 UID / 用户名 / 邮箱搜索"
                              emptyText="没有找到域内用户"
                              minHeight={44}
                            />
                            <p className="text-xs text-muted-foreground">只能选择当前域中的一名用户；服务端会再次校验。</p>
                            {managedAuthorSearchError ? (
                              <p role="alert" className="text-xs text-destructive">
                                {managedAuthorSearchError}
                              </p>
                            ) : null}
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
                </div>
              ) : null}

              <div className="border-t border-border/60">
                <header className="px-5 py-4">
                  <h3 className="text-sm font-semibold tracking-tight">题面正文</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Markdown 内容；粘贴图片继续使用现有附加文件 API。</p>
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
              </div>

              {!isCreate ? (
                <div className="border-t border-border/60">
                  <header className="px-5 py-4">
                    <h3 className="text-sm font-semibold tracking-tight">可见性</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {managed ? '托管草稿保持隐藏；管理员从权限与协作页确认元数据并发布。' : '发布与维护权限沿用现有模型。'}
                    </p>
                  </header>
                  <div className="grid gap-4 p-5 sm:grid-cols-2">
                    {!isCreate && canPublish ? <input type="hidden" name="hidden" value={hiddenValue ? 'true' : 'false'} /> : null}
                    {!isCreate && canPublish ? <input type="hidden" name="lockHidden" value={lockHiddenValue ? 'true' : 'false'} /> : null}
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-muted/45 px-3">
                      <Checkbox checked={hiddenValue} disabled={!canPublish} onCheckedChange={setHiddenValue} aria-label="隐藏题目" />
                      <span className="flex items-center gap-1.5 text-sm">
                        {hiddenValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        隐藏题目
                      </span>
                    </label>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-muted/45 px-3">
                      <Checkbox
                        checked={lockHiddenValue}
                        disabled={managed && !canPublish}
                        onCheckedChange={setLockHiddenValue}
                        aria-label="锁定隐藏"
                      />
                      <span className="flex items-center gap-1.5 text-sm">
                        <Lock className="size-3.5" />
                        锁定隐藏（比赛结束后不自动公开）
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}
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

            <footer className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">{saveError ? <p className="text-sm text-destructive">{saveError}</p> : status}</div>
              <Button type="submit" className="min-h-11 gap-1.5 sm:min-w-36" disabled={saveState === 'saving'}>
                {saveState === 'saving' ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                ) : isCreate ? (
                  <ArrowRight className="size-4" />
                ) : (
                  <Save className="size-4" />
                )}
                {isCreate ? '创建并进入工作区' : '保存修改'}
              </Button>
            </footer>
          </form>
        </div>
      )}
    </ProblemEditorWorkspace>
  );
}
