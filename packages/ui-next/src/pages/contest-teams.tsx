import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Copy,
  Crown,
  Lock,
  LockOpen,
  LogOut,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel } from '@/components/domain-user-search';
import {
  TEAM_DIALOG_BUTTON_CLASS,
  TEAM_DIALOG_CONTROL_CLASS,
  TEAM_DIALOG_MULTI_SELECT_CLASS,
  TEAM_DIALOG_TEXTAREA_CLASS,
  TeamDialogBody,
  TeamDialogContent,
  TeamDialogField,
  TeamDialogFooter,
} from '@/components/team-dialog';
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { useBreakpoint } from '@/components/ui/media';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { evaluateSelfTeamName } from '@/lib/contest-team-form';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { formatDateTime } from '@/lib/format';

interface TeamUser extends DomainUserOption {
  uname: string;
  displayName: string;
}

interface TeamView {
  teamId: string;
  name: string;
  description: string;
  captainUid: number;
  memberUids: number[];
  managementMode: 'self' | 'admin';
  revision: number;
  active: boolean;
  unrank?: boolean;
  createdAt: string;
  updatedAt: string;
  emergencyConfirmation?: string;
}

interface InviteView {
  inviteId: string;
  teamId: string;
  teamName: string;
  inviterUid: number;
  teamRevision: number;
  currentRevision: number | null;
  memberUids: number[];
  captainUid: number | null;
  createdAt: string;
  canAccept: boolean;
}

interface ConfirmAction {
  title: string;
  description: string;
  operation: string;
  fields: Record<string, string | number>;
  destructive?: boolean;
}

interface ContestTeamsPageData {
  workspaceKind?: string;
  tdoc?: {
    docId?: string | number;
    title?: string;
    beginAt?: unknown;
  };
  batch?: {
    name?: string;
    description?: string;
    closedAt?: unknown;
    createdAt?: unknown;
    revision?: string | number;
  };
  copiedFromBatch?: { batchId?: string; name?: string } | null;
  ownTeam?: TeamView | null;
  pendingInvites?: InviteView[];
  users?: Record<string, TeamUser>;
  capabilities?: {
    canClose?: boolean;
    canCopy?: boolean;
    canCreate?: boolean;
    canEditOwn?: boolean;
    canEmergencyEdit?: boolean;
    canInvite?: boolean;
    canLeave?: boolean;
    canManage?: boolean;
    canReopen?: boolean;
    canSetOwnUnrank?: boolean;
    started?: boolean;
  };
  teams?: TeamView[];
  workspaceUrl?: string;
  teamSearch?: string;
  vigilRoleSyncWarning?: boolean;
  batchTeamCount?: string | number;
  memberCount?: string | number;
  teamCount?: string | number;
  teamPage?: string | number;
  teamPageCount?: string | number;
}

type TeamPrimaryAction = 'create-self' | 'save-info' | 'invite' | 'admin-create';

function userLabel(users: Record<string, TeamUser>, uid: number) {
  const user = users[String(uid)];
  if (!user) return `UID ${uid}`;
  return user.displayName && user.displayName !== user.uname ? `${user.displayName}（${user.uname}）` : user.uname;
}

function teamUser(users: Record<string, TeamUser>, uid: number): TeamUser {
  return users[String(uid)] || { _id: uid, uname: `UID ${uid}`, displayName: `UID ${uid}` };
}

function studentIdentity(user: TeamUser) {
  return [user.studentId ? `学号 ${user.studentId}` : '', user.realName].filter(Boolean).join(' · ');
}

function unrankConfirm(team: TeamView, next: boolean): ConfirmAction {
  return {
    title: next ? `将「${team.name}」设为打星参赛？` : `将「${team.name}」恢复为正式参赛？`,
    description: next ? '打星后这支队伍仍会出现在榜上，但正式名次显示为 *，旁边正式队伍的名次会让开。' : '恢复后这支队伍会重新占用正式名次。',
    operation: 'set_unrank',
    fields: { teamId: team.teamId, expectedRevision: team.revision, unrank: next ? 'true' : 'false' },
  };
}

const COPY_BATCH_NAME_LIMIT = 64;
const COPY_BATCH_NAME_SUFFIX = '（副本）';

function copyBatchNameDefault(name: unknown): string {
  const base = String(name || '');
  const room = COPY_BATCH_NAME_LIMIT - COPY_BATCH_NAME_SUFFIX.length;
  return `${base.slice(0, room)}${COPY_BATCH_NAME_SUFFIX}`;
}

function teamPrimaryAction(
  ownTeam: TeamView | null,
  capabilities: NonNullable<ContestTeamsPageData['capabilities']>,
): TeamPrimaryAction | null {
  if (!ownTeam && capabilities.canCreate) return 'create-self';
  if (ownTeam && capabilities.canEditOwn) return 'save-info';
  if (ownTeam && capabilities.canInvite) return 'invite';
  if (capabilities.canManage) return 'admin-create';
  if (!ownTeam) return 'create-self';
  return null;
}

function ConfirmDialog({ action, onClose }: { action: ConfirmAction | null; onClose: () => void }) {
  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && onClose()}>
      <TeamDialogContent
        titleId="team-confirm-dialog-title"
        descriptionId="team-confirm-dialog-description"
        title={action?.title || '确认操作'}
        description={action?.description || '确认后将立即执行此操作。'}
        icon={action?.destructive ? <AlertTriangle className="size-5" /> : <ShieldCheck className="size-5" />}
        tone={action?.destructive ? 'destructive' : 'primary'}
        onClose={onClose}
      >
        <form method="post" className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="operation" value={action?.operation || ''} />
          {Object.entries(action?.fields || {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <TeamDialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} className={TEAM_DIALOG_BUTTON_CLASS}>
              取消
            </Button>
            <Button type="submit" variant={action?.destructive ? 'danger' : 'primary'} className={TEAM_DIALOG_BUTTON_CLASS}>
              确认
            </Button>
          </TeamDialogFooter>
        </form>
      </TeamDialogContent>
    </Dialog>
  );
}

function MemberList({ team, users, actions }: { team: TeamView; users: Record<string, TeamUser>; actions?: (uid: number) => ReactNode }) {
  return (
    <div className="divide-y divide-line-subtle">
      {team.memberUids.map((uid) => {
        const action = actions?.(uid);
        return (
          <div key={uid} className="flex min-h-12 items-center gap-3 px-3 py-2">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">{userLabel(users, uid).slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg">{userLabel(users, uid)}</span>
                {team.captainUid === uid ? (
                  <Badge tone="brand" size="sm">
                    <Crown className="size-3" /> 队长
                  </Badge>
                ) : null}
              </div>
              <p className="min-w-0 truncate text-2xs text-fg-subtle">
                {studentIdentity(teamUser(users, uid)) || '未绑定学生档案'}
                <span className="font-mono"> · UID {uid}</span>
              </p>
            </div>
            {action ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{action}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function ManagerTeamRow({
  team,
  users,
  started,
  canEmergencyEdit,
  emergencyAdminEdit,
  onUnrank,
  onEdit,
  onDeactivate,
}: {
  team: TeamView;
  users: Record<string, TeamUser>;
  started: boolean;
  canEmergencyEdit: boolean;
  emergencyAdminEdit: boolean;
  onUnrank: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 py-3 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_minmax(16rem,auto)] xl:items-center xl:gap-5">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{team.name}</h3>
          <Badge tone={team.managementMode === 'admin' ? 'brand' : 'neutral'} size="sm">
            {team.managementMode === 'admin' ? '管理员' : '自主'}
          </Badge>
          {team.unrank ? (
            <Badge tone="warning" size="sm">
              <Star className="size-3" />
              已打星
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 min-w-0 truncate text-xs text-fg-subtle">{team.description || '无说明'}</p>
        <p className="mt-1 font-mono text-2xs text-fg-subtle tabular">
          {team.memberUids.length}/3 人 · rev.{team.revision}
        </p>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <div className="flex shrink-0 -space-x-1.5">
          {team.memberUids.map((uid) => (
            <Avatar key={uid} className="size-6">
              <AvatarFallback className="text-2xs">{userLabel(users, uid).slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-fg-subtle xl:hidden">成员与绑定身份</p>
          {team.memberUids.map((uid) => {
            const member = teamUser(users, uid);
            return (
              <p key={uid} className="flex min-w-0 items-center gap-1 text-xs">
                <span className="min-w-0 truncate font-medium text-fg">{userLabel(users, uid)}</span>
                {team.captainUid === uid ? <Crown className="size-3 shrink-0 text-warning-fg" aria-label="队长" /> : null}
                <span className="min-w-0 truncate text-fg-subtle">
                  · {studentIdentity(member) || '未绑定学生档案'} · UID {uid}
                </span>
              </p>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap justify-end gap-2 xl:justify-self-end">
        <Button type="button" variant="secondary" size="sm" onClick={onUnrank}>
          <Star /> {team.unrank ? '恢复正式' : '打星'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={started && !canEmergencyEdit}
          onClick={onEdit}
        >
          <Pencil /> {emergencyAdminEdit ? '紧急调整' : started ? '已冻结' : '编辑'}
        </Button>
        <Button type="button" variant="danger-soft" size="sm" disabled={started} onClick={onDeactivate}>
          停用
        </Button>
      </div>
    </div>
  );
}

export function ContestTeamsPage() {
  const bs = useBootstrap();
  // DataTable's stack cards are always a button. Row actions stay outside that button below md.
  const managerTable = useBreakpoint('md');
  const data = bs.page.data as ContestTeamsPageData;
  const isBatch = data.workspaceKind === 'batch';
  const tdoc = data.tdoc || {};
  const batch = data.batch || {};
  const copiedFromBatch = data.copiedFromBatch || null;
  const tid = String(tdoc.docId || '');
  const ownTeam = (data.ownTeam || null) as TeamView | null;
  const invitations = (data.pendingInvites || []) as InviteView[];
  const users = (data.users || {}) as Record<string, TeamUser>;
  const capabilities = data.capabilities || {};
  const managedTeams = (data.teams || []) as TeamView[];
  const teamsUrl = String(data.workspaceUrl || `/contest/${encodeURIComponent(tid)}/teams`);
  const teamSearch = String(data.teamSearch || '');
  const teamPageUrl = teamSearch ? `${teamsUrl}?teamSearch=${encodeURIComponent(teamSearch)}` : teamsUrl;
  const currentUid = Number(bs.user.id);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [createSelfOpen, setCreateSelfOpen] = useState(false);
  const [copyBatchOpen, setCopyBatchOpen] = useState(false);
  const [createSelfNameError, setCreateSelfNameError] = useState('');
  const [inviteTargets, setInviteTargets] = useState<TeamUser[]>([]);
  const [adminCreateOpen, setAdminCreateOpen] = useState(false);
  const [adminCreateMembers, setAdminCreateMembers] = useState<TeamUser[]>([]);
  const [adminCreateCaptain, setAdminCreateCaptain] = useState('');
  const [editingTeam, setEditingTeam] = useState<TeamView | null>(null);
  const [editingMembers, setEditingMembers] = useState<TeamUser[]>([]);
  const [editingCaptain, setEditingCaptain] = useState('');

  const searchUsers = useCallback(
    async (query: string): Promise<TeamUser[]> => {
      const value = query.trim();
      if (!value) return [];
      const response = await fetchHydroResponse(`${teamsUrl}?search=${encodeURIComponent(value)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '队员搜索失败'));
      const body = await response.json();
      return Array.isArray(body?.users) ? body.users : [];
    },
    [teamsUrl],
  );

  const openAdminEdit = (team: TeamView) => {
    setEditingTeam(team);
    setEditingMembers(team.memberUids.map((uid) => teamUser(users, uid)));
    setEditingCaptain(String(team.captainUid));
  };

  const handleCreateSelfOpenChange = (open: boolean) => {
    setCreateSelfOpen(open);
    if (!open) setCreateSelfNameError('');
  };

  const handleCreateSelfSubmit = (event: FormEvent<HTMLFormElement>) => {
    const nameInput = event.currentTarget.elements.namedItem('name');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('Self-team name input is missing.');
    const nameValidation = evaluateSelfTeamName(nameInput.value);
    if (!nameValidation.preventSubmit) {
      setCreateSelfNameError('');
      return;
    }
    event.preventDefault();
    setCreateSelfNameError(nameValidation.error);
    nameInput.focus();
  };

  const ownIsCaptain = !!ownTeam && ownTeam.captainUid === currentUid;
  const ownIsSelfManaged = ownTeam?.managementMode === 'self';
  const emergencyAdminEdit = !!capabilities.started && !!capabilities.canEmergencyEdit;
  const primaryAction = teamPrimaryAction(ownTeam, capabilities);
  const showOwnTools = !!capabilities.canEditOwn || !!capabilities.canInvite;
  const renderManagerRow = (team: TeamView) => (
    <ManagerTeamRow
      team={team}
      users={users}
      started={!!capabilities.started}
      canEmergencyEdit={!!capabilities.canEmergencyEdit}
      emergencyAdminEdit={emergencyAdminEdit}
      onUnrank={() => setConfirmAction(unrankConfirm(team, !team.unrank))}
      onEdit={() => openAdminEdit(team)}
      onDeactivate={() => setConfirmAction({
        title: `停用「${team.name}」？`,
        description: '队伍不会被物理删除，但成员会被释放，可以重新加入其它队伍。',
        operation: 'deactivate',
        fields: { teamId: team.teamId, expectedRevision: team.revision },
        destructive: true,
      })}
    />
  );
  const managerColumns: Column<TeamView>[] = [
    {
      key: 'team',
      header: (
        <>
          <span className="xl:hidden">队伍</span>
          <span className="hidden w-full min-w-0 xl:grid xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_minmax(16rem,auto)] xl:items-center xl:gap-5">
            <span>队伍</span>
            <span className="min-w-0">成员与绑定身份</span>
            <span className="text-right">操作</span>
          </span>
        </>
      ),
      stackRole: 'title',
      cell: (team) => renderManagerRow(team),
    },
  ];
  const managerEmpty = (
    <EmptyState
      compact
      icon={<Users />}
      title={teamSearch ? '没有匹配的队伍' : isBatch ? '本批次还没有有效队伍' : '本场还没有有效队伍'}
      description={teamSearch ? '换一个队伍名称继续搜索。' : '创建后会在这里集中管理成员与队长。'}
    />
  );

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={(
          <Breadcrumb
            items={isBatch
              ? [
                { label: '返回队伍中心', href: '/teams' },
                { label: '赛前组队' },
              ]
              : [
                { label: '返回比赛', href: '/contest' },
                { label: '比赛详情', href: `/contest/${encodeURIComponent(tid)}` },
                { label: '比赛队伍' },
              ]}
          />
        )}
        title={isBatch ? '赛前组队' : '比赛队伍'}
        description={(
          <>
            <span className="block">{isBatch ? batch.name : tdoc.title}</span>
            {isBatch && batch.description ? <span className="mt-1 block">{batch.description}</span> : null}
            {isBatch && copiedFromBatch ? (
              <span className="mt-1 block text-xs text-fg-subtle">
                复制自{' '}
                <a
                  href={`/teams/${encodeURIComponent(String(copiedFromBatch.batchId))}`}
                  className="font-medium text-brand-fg underline-offset-4 hover:underline"
                >
                  {copiedFromBatch.name}
                </a>
              </span>
            ) : null}
          </>
        )}
        meta={(
          <>
            <Badge variant="outline">1–3 人 ACM</Badge>
            {capabilities.started ? (
              <Badge tone={isBatch ? 'neutral' : 'danger'} variant={isBatch ? 'outline' : 'soft'}>
                {isBatch ? '批次已关闭 · 可绑定比赛' : '已开赛 · 普通操作冻结'}
              </Badge>
            ) : (
              <Badge tone="success">{isBatch ? '开放组队' : '赛前可调整'}</Badge>
            )}
            <span>
              {isBatch ? (batch.closedAt ? '关闭时间' : '创建时间') : '开始时间'}
              <strong className="ml-2 font-medium text-fg tabular">
                {formatDateTime(isBatch ? batch.closedAt || batch.createdAt : tdoc.beginAt, bs.locale)}
              </strong>
            </span>
          </>
        )}
        actions={isBatch && (capabilities.canCopy || capabilities.canReopen || capabilities.canClose) ? (
          <>
            {capabilities.canCopy ? (
              <Button type="button" variant="secondary" onClick={() => setCopyBatchOpen(true)}>
                <Copy /> 复制批次
              </Button>
            ) : null}
            {capabilities.canReopen ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setConfirmAction({
                    title: '重新开放这个批次？',
                    description: '重新开放后可继续改队和处理待邀请，之后必须再次关闭才能用于比赛。若批次已生成过比赛快照，服务端会拒绝并要求改用复制。',
                    operation: 'reopen',
                    fields: { expectedRevision: Number(batch.revision || 0) },
                  })
                }
              >
                <LockOpen /> 重新开放
              </Button>
            ) : null}
            {capabilities.canClose ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setConfirmAction({
                    title: '关闭这个组队批次？',
                    description:
                      '关闭后普通组队操作全部冻结，阵容可用于生成团队 ACM 比赛快照。未被任何比赛使用前仍可重新开放；一旦生成过快照，只能复制为新批次。',
                    operation: 'close',
                    fields: { expectedRevision: Number(batch.revision || 0) },
                  })
                }
              >
                <Lock /> 关闭批次
              </Button>
            ) : null}
          </>
        ) : undefined}
      />

      {!isBatch && data.vigilRoleSyncWarning ? (
        <Alert tone="danger" title="队伍已保存，但客户端角色刷新失败">
          OJ 提交权限已经按新队伍生效；请让受影响客户端重新连接，或检查 Vigil Server 后再次调整。
        </Alert>
      ) : null}

      {capabilities.started ? (
        <Alert tone="warning" title={isBatch ? '组队批次已关闭' : '队伍已冻结'}>
          {isBatch ? '当前阵容只读，可作为后续团队 ACM 比赛的快照来源。' : '普通成员与队长只能查看。管理员紧急调整不会重算或转移已经取得的成绩。'}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-fg text-balance">我的队伍</h2>
          <p className="text-sm text-fg-muted text-pretty">一个账号在{isBatch ? '当前组队批次' : '本场比赛'}只能属于一支有效队伍。</p>
        </div>

        {ownTeam ? (
          <div className={showOwnTools ? 'grid min-w-0 gap-4 lg:grid-cols-2' : 'grid min-w-0 gap-4'}>
            <Panel
              className="min-w-0"
              title={(
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate">{ownTeam.name}</span>
                  <Badge tone={ownTeam.managementMode === 'admin' ? 'brand' : 'neutral'}>
                    {ownTeam.managementMode === 'admin' ? '管理员编队' : '自主队伍'}
                  </Badge>
                  {ownTeam.unrank ? (
                    <Badge tone="warning">
                      <Star className="size-3" />
                      已打星
                    </Badge>
                  ) : null}
                </span>
              )}
              description={ownTeam.description || '暂无队伍说明'}
              actions={<span className="font-mono text-xs text-fg-subtle tabular">rev.{ownTeam.revision}</span>}
            >
              <div className="flex flex-col gap-4">
                <MemberList
                  team={ownTeam}
                  users={users}
                  actions={(uid) =>
                    capabilities.canEditOwn && ownIsCaptain && ownIsSelfManaged && uid !== currentUid ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setConfirmAction({
                              title: `转让队长给 ${userLabel(users, uid)}？`,
                              description: '转让后，对方立即获得队伍管理权；你仍保留普通成员身份。',
                              operation: 'transfer_captain',
                              fields: { teamId: ownTeam.teamId, expectedRevision: ownTeam.revision, captainUid: uid },
                            })
                          }
                        >
                          <Crown /> 转让
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger-soft"
                          onClick={() =>
                            setConfirmAction({
                              title: `移除 ${userLabel(users, uid)}？`,
                              description: isBatch
                                ? '该成员会立即退出本批次的当前队伍，并可加入本批次的其它队伍。'
                                : '该成员会立即失去本队身份。操作不会改变队伍已经取得的成绩。',
                              operation: 'remove_member',
                              fields: { teamId: ownTeam.teamId, expectedRevision: ownTeam.revision, memberUid: uid },
                              destructive: true,
                            })
                          }
                        >
                          <X /> 移除
                        </Button>
                      </>
                    ) : null
                  }
                />

                {capabilities.canManage || capabilities.canSetOwnUnrank ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                    <p className="min-w-0 flex-1 text-xs text-fg-subtle">
                      {ownTeam.unrank ? '本队当前是打星参赛，正式名次会让开。' : '打星后仍会出现在榜上，正式名次显示为 *。'}
                    </p>
                    <Button type="button" variant="secondary" onClick={() => setConfirmAction(unrankConfirm(ownTeam, !ownTeam.unrank))}>
                      <Star /> {ownTeam.unrank ? '恢复正式' : '打星参赛'}
                    </Button>
                  </div>
                ) : ownTeam.unrank ? (
                  <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-fg-subtle">本队已打星。比赛开始后如需改回正式，请联系管理员。</p>
                ) : null}

                {capabilities.canLeave ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                    <p className="min-w-0 flex-1 text-xs text-fg-subtle">
                      {ownIsCaptain && ownTeam.memberUids.length > 1 ? '队长退出前必须先转让队长。' : '退出后可接受其它队伍邀请。'}
                    </p>
                    <Button
                      type="button"
                      variant="danger-soft"
                      disabled={ownIsCaptain && ownTeam.memberUids.length > 1}
                      onClick={() =>
                        setConfirmAction({
                          title: ownTeam.memberUids.length === 1 ? '停用这支单人队？' : '退出当前队伍？',
                          description:
                            ownTeam.memberUids.length === 1
                              ? '最后一名成员退出后，队伍会被停用但不会物理删除。'
                              : isBatch
                                ? '退出后你会立即失去本批次的当前队伍身份。'
                                : '退出后你会立即失去本队身份，已有成绩仍保留在稳定 teamId 下。',
                          operation: 'leave',
                          fields: { teamId: ownTeam.teamId, expectedRevision: ownTeam.revision },
                          destructive: true,
                        })
                      }
                    >
                      <LogOut /> {ownTeam.memberUids.length === 1 ? '停用队伍' : '退出队伍'}
                    </Button>
                  </div>
                ) : ownTeam.managementMode === 'admin' && !capabilities.started ? (
                  <p className="rounded-md bg-surface-sunken px-3 py-2 text-xs text-fg-subtle">管理员编队的成员不能自行退出或调整阵容。</p>
                ) : null}
              </div>
            </Panel>

            {showOwnTools ? (
              <div className="flex min-w-0 flex-col gap-4">
                {capabilities.canEditOwn ? (
                  <Panel
                    title={(
                      <span className="inline-flex items-center gap-1.5">
                        <Pencil className="size-4 shrink-0 text-fg-subtle" />
                        队伍信息
                      </span>
                    )}
                  >
                    <form method="post">
                      <input type="hidden" name="operation" value="update_info" />
                      <input type="hidden" name="teamId" value={ownTeam.teamId} />
                      <input type="hidden" name="expectedRevision" value={ownTeam.revision} />
                      <div className="flex flex-col gap-5">
                        <Input name="name" defaultValue={ownTeam.name} required maxLength={64} placeholder="队伍名称" />
                        <Textarea name="description" defaultValue={ownTeam.description} maxLength={500} placeholder="队伍说明（可选）" />
                        <Button type="submit" variant={primaryAction === 'save-info' ? 'primary' : 'secondary'} className="w-full">
                          保存队伍信息
                        </Button>
                      </div>
                    </form>
                  </Panel>
                ) : null}

                {capabilities.canInvite ? (
                  <Panel
                    title={(
                      <span className="inline-flex items-center gap-1.5">
                        <UserPlus className="size-4 shrink-0 text-fg-subtle" />
                        邀请队员
                      </span>
                    )}
                  >
                    <form method="post">
                      <input type="hidden" name="operation" value="invite" />
                      <div className="flex flex-col gap-5">
                        <MultiSelect<TeamUser>
                          value={inviteTargets}
                          onChange={setInviteTargets}
                          loadOptions={searchUsers}
                          getKey={(item) => String(item._id)}
                          getLabel={domainUserSearchLabel}
                          renderChip={(item) => <span>{item.displayName || item.uname}</span>}
                          renderOption={(item) => <DomainUserSearchOption user={item} />}
                          name="inviteeUid"
                          maxItems={1}
                          placeholder="搜索 UID / OJ 用户 / 学号 / 姓名"
                          emptyText={isBatch ? '没有可加入本批次且尚未入队的用户' : '没有符合本场资格且未入队的用户'}
                        />
                        <Button
                          type="submit"
                          variant={primaryAction === 'invite' ? 'primary' : 'secondary'}
                          className="w-full"
                          disabled={inviteTargets.length !== 1}
                        >
                          发送邀请
                        </Button>
                      </div>
                    </form>
                  </Panel>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-3">
            <Panel title="待处理邀请" className="lg:col-span-2">
              {invitations.length ? (
                <div className="divide-y divide-line-subtle">
                  {invitations.map((invite) => (
                    <div key={invite.inviteId} className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="min-w-0 truncate font-medium text-fg">{invite.teamName}</p>
                          <Badge variant="outline">
                            {invite.memberUids.length}/3 人
                          </Badge>
                          {!invite.canAccept ? (
                            <Badge tone="danger">
                              邀请已失效
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 min-w-0 truncate text-xs text-fg-subtle">
                          邀请人：{userLabel(users, invite.inviterUid)} · {formatDateTime(invite.createdAt, bs.locale)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="soft"
                          disabled={!invite.canAccept}
                          onClick={() =>
                            setConfirmAction({
                              title: `加入「${invite.teamName}」？`,
                              description: `接受后会自动清理你在${isBatch ? '本批次' : '本场'}的其它待处理邀请，并由唯一索引确保不会同时属于两队。`,
                              operation: 'accept_invite',
                              fields: { inviteId: invite.inviteId },
                            })
                          }
                        >
                          接受
                        </Button>
                        <Button
                          type="button"
                          variant="danger-soft"
                          disabled={capabilities.started}
                          onClick={() =>
                            setConfirmAction({
                              title: `拒绝「${invite.teamName}」的邀请？`,
                              description: '只会移除发给你的这一条邀请，不会改变该队伍。',
                              operation: 'decline_invite',
                              fields: { inviteId: invite.inviteId },
                              destructive: true,
                            })
                          }
                        >
                          拒绝
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-fg-muted">目前没有发给你的待处理邀请。</p>
              )}
            </Panel>

            <Panel title={isBatch ? '开始组队' : '开始参赛'}>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-fg-muted text-pretty">你可以先创建一支队伍再邀请同伴，也可以明确创建单人队，之后仍能继续邀请。</p>
                <Button
                  type="button"
                  variant={primaryAction === 'create-self' ? 'primary' : 'secondary'}
                  className="w-full"
                  disabled={!capabilities.canCreate}
                  onClick={() => setCreateSelfOpen(true)}
                >
                  <Users /> 创建队伍
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  variant="secondary"
                  disabled={!capabilities.canCreate}
                  onClick={() =>
                    setConfirmAction({
                      title: isBatch ? '创建单人队？' : '以单人队参赛？',
                      description: `系统会立即创建由你担任队长的一人队。${isBatch ? '批次关闭前' : '开赛前'}仍可以邀请最多两名队友。`,
                      operation: 'create_solo',
                      fields: {},
                    })
                  }
                >
                  <ShieldCheck /> {isBatch ? '创建单人队' : '以单人队参赛'}
                </Button>
              </div>
            </Panel>
          </div>
        )}
      </section>

      {capabilities.canManage ? (
        <section className="flex flex-col gap-4 border-t border-line pt-6">
          <Panel
            flush
            title={(
              <span className="flex w-full min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate">管理员编队</span>
                <Badge tone="neutral">
                  {Number(data.batchTeamCount || 0)} 支 · {Number(data.memberCount || 0)} 人
                </Badge>
                {data.teamSearch ? (
                  <Badge variant="outline">
                    匹配 {Number(data.teamCount || 0)} 支
                  </Badge>
                ) : null}
              </span>
            )}
            description="每页 20 支，按队伍快速检查阵容与学生身份。"
            actions={(
              <Button
                type="button"
                variant={primaryAction === 'admin-create' ? 'primary' : 'secondary'}
                disabled={capabilities.started}
                onClick={() => {
                  setAdminCreateMembers([]);
                  setAdminCreateCaptain('');
                  setAdminCreateOpen(true);
                }}
              >
                <Plus /> 新建管理员队伍
              </Button>
            )}
          >
            <div className="border-b border-line px-4 py-3">
              <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  name="teamSearch"
                  defaultValue={teamSearch}
                  placeholder="按队伍名称搜索"
                  maxLength={64}
                  leading={<Search />}
                  className="sm:w-72"
                />
                <Button type="submit" variant="secondary">
                  搜索
                </Button>
                {teamSearch ? (
                  <Button asChild type="button" variant="ghost">
                    <a href={teamsUrl}>清除</a>
                  </Button>
                ) : null}
              </form>
            </div>
            {managerTable ? (
              <DataTable
                mobile="stack"
                columns={managerColumns}
                rows={managedTeams}
                rowKey={(team) => team.teamId}
                empty={managerEmpty}
              />
            ) : managedTeams.length === 0 ? (
              managerEmpty
            ) : (
              <ul className="divide-y divide-line-subtle">
                {managedTeams.map((team) => (
                  <li key={team.teamId} className="px-4">
                    {renderManagerRow(team)}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Pagination current={Number(data.teamPage || 1)} total={Number(data.teamPageCount || 1)} baseUrl={teamPageUrl} />
        </section>
      ) : null}

      <Dialog open={createSelfOpen} onOpenChange={handleCreateSelfOpenChange}>
        <TeamDialogContent
          titleId="create-self-dialog-title"
          descriptionId="create-self-dialog-description"
          title="创建自主队伍"
          description="创建后你将成为队长，可以继续邀请至多两名队员。"
          icon={<Crown className="size-5" />}
          onClose={() => handleCreateSelfOpenChange(false)}
        >
          <form method="post" noValidate onSubmit={handleCreateSelfSubmit} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="operation" value="create_self" />
            <TeamDialogBody>
              <TeamDialogField htmlFor="create-self-name" label="队伍名称" hint="1–64 个字符">
                <Input
                  id="create-self-name"
                  name="name"
                  required
                  maxLength={64}
                  autoFocus
                  invalid={!!createSelfNameError}
                  aria-invalid={!!createSelfNameError}
                  aria-describedby={createSelfNameError ? 'create-self-name-error' : undefined}
                  placeholder="给队伍起一个名字"
                  onChange={(event) => {
                    if (createSelfNameError && event.currentTarget.value.trim()) setCreateSelfNameError('');
                  }}
                  className={TEAM_DIALOG_CONTROL_CLASS}
                />
                <div className="min-h-5">
                  {createSelfNameError ? (
                    <p id="create-self-name-error" role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger-fg">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {createSelfNameError}
                    </p>
                  ) : null}
                </div>
              </TeamDialogField>
              <TeamDialogField htmlFor="create-self-description" label="队伍说明" hint="可选 · 最多 500 个字符">
                <Textarea
                  id="create-self-description"
                  name="description"
                  maxLength={500}
                  placeholder="训练方向、队伍介绍等"
                  className={TEAM_DIALOG_TEXTAREA_CLASS}
                />
              </TeamDialogField>
            </TeamDialogBody>
            <TeamDialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleCreateSelfOpenChange(false)}
                className={TEAM_DIALOG_BUTTON_CLASS}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" className={TEAM_DIALOG_BUTTON_CLASS}>
                创建并成为队长
              </Button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>

      <Dialog open={adminCreateOpen} onOpenChange={setAdminCreateOpen}>
        <TeamDialogContent
          titleId="admin-create-team-dialog-title"
          descriptionId="admin-create-team-dialog-description"
          title="新建管理员队伍"
          description={isBatch ? '直接编入本批次，成员不能自行退出。' : '直接编入本场比赛，成员不能自行退出。'}
          icon={<ShieldCheck className="size-5" />}
          onClose={() => setAdminCreateOpen(false)}
        >
          <form method="post" className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="operation" value="create_admin" />
            <TeamDialogBody>
              <TeamDialogField htmlFor="admin-create-team-name" label="队伍名称" hint="1–64 个字符">
                <Input
                  id="admin-create-team-name"
                  name="name"
                  required
                  maxLength={64}
                  autoFocus
                  placeholder="给队伍起一个名字"
                  className={TEAM_DIALOG_CONTROL_CLASS}
                />
              </TeamDialogField>
              <TeamDialogField htmlFor="admin-create-team-description" label="队伍说明" hint="可选 · 最多 500 个字符">
                <Textarea
                  id="admin-create-team-description"
                  name="description"
                  maxLength={500}
                  placeholder="训练方向、队伍介绍等"
                  className={TEAM_DIALOG_TEXTAREA_CLASS}
                />
              </TeamDialogField>
              <TeamDialogField label="成员" hint={`${adminCreateMembers.length}/3 人`}>
                <MultiSelect<TeamUser>
                  value={adminCreateMembers}
                  onChange={(next) => {
                    setAdminCreateMembers(next);
                    if (!next.some((item) => String(item._id) === adminCreateCaptain)) setAdminCreateCaptain(String(next[0]?._id || ''));
                  }}
                  loadOptions={searchUsers}
                  getKey={(item) => String(item._id)}
                  getLabel={domainUserSearchLabel}
                  renderChip={(item) => <span>{item.displayName || item.uname}</span>}
                  renderOption={(item) => <DomainUserSearchOption user={item} />}
                  name="memberUids"
                  maxItems={3}
                  className={TEAM_DIALOG_MULTI_SELECT_CLASS}
                  minHeight={48}
                  placeholder={isBatch ? '按 OJ 用户、学号或姓名搜索可加入成员' : '按 OJ 用户、学号或姓名搜索符合资格的成员'}
                />
              </TeamDialogField>
              <TeamDialogField label="队长" hint={adminCreateMembers.length ? '从已选成员中指定' : '请先选择成员'}>
                <SimpleSelect
                  name="captainUid"
                  value={adminCreateCaptain}
                  onValueChange={setAdminCreateCaptain}
                  options={adminCreateMembers.map((item) => ({ value: String(item._id), label: userLabel({ [item._id]: item }, item._id) }))}
                  disabled={!adminCreateMembers.length}
                  placeholder="选择队长"
                  className={TEAM_DIALOG_CONTROL_CLASS}
                />
              </TeamDialogField>
            </TeamDialogBody>
            <TeamDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setAdminCreateOpen(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={!adminCreateMembers.length || !adminCreateCaptain} className={TEAM_DIALOG_BUTTON_CLASS}>
                创建队伍
              </Button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>

      <Dialog open={copyBatchOpen} onOpenChange={setCopyBatchOpen}>
        <TeamDialogContent
          titleId="copy-team-batch-dialog-title"
          descriptionId="copy-team-batch-dialog-description"
          title="复制组队批次"
          description="创建一份可继续调整的独立开放批次。"
          icon={<Copy className="size-5" />}
          onClose={() => setCopyBatchOpen(false)}
        >
          <form method="post" className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="operation" value="copy" />
            <TeamDialogBody>
              <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm">
                <p className="font-semibold text-fg">
                  将复制 {Number(data.batchTeamCount || 0)} 支队伍、{Number(data.memberCount || 0)} 名成员
                </p>
                <p className="mt-1 text-xs text-fg-subtle">队伍和成员会获得全新 ID；邀请、历史记录、关闭状态和比赛快照不会复制。</p>
              </div>
              <TeamDialogField htmlFor="copy-team-batch-name" label="新批次名称" hint="1–64 个字符">
                <Input
                  id="copy-team-batch-name"
                  name="name"
                  required
                  maxLength={64}
                  autoFocus
                  defaultValue={copyBatchNameDefault(batch.name)}
                  className={TEAM_DIALOG_CONTROL_CLASS}
                />
              </TeamDialogField>
              <TeamDialogField htmlFor="copy-team-batch-description" label="批次说明" hint="可选 · 最多 500 个字符">
                <Textarea
                  id="copy-team-batch-description"
                  name="description"
                  maxLength={500}
                  defaultValue={String(batch.description || '')}
                  className={TEAM_DIALOG_TEXTAREA_CLASS}
                />
              </TeamDialogField>
            </TeamDialogBody>
            <TeamDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCopyBatchOpen(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
                取消
              </Button>
              <Button type="submit" variant="primary" className={TEAM_DIALOG_BUTTON_CLASS}>
                复制为开放批次
              </Button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>

      <Dialog open={!!editingTeam} onOpenChange={(open) => !open && setEditingTeam(null)}>
        <TeamDialogContent
          titleId="edit-team-dialog-title"
          descriptionId="edit-team-dialog-description"
          title={emergencyAdminEdit ? '赛中紧急调整队伍' : '编辑队伍'}
          description={emergencyAdminEdit ? '本次调整会立即改变客户端角色，请核对成员与队长。' : '维护队伍资料、管理方式、成员与队长。'}
          icon={emergencyAdminEdit ? <AlertTriangle className="size-5" /> : <Pencil className="size-5" />}
          tone={emergencyAdminEdit ? 'destructive' : 'primary'}
          onClose={() => setEditingTeam(null)}
        >
          {editingTeam ? (
            <form method="post" className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="operation" value="update_admin" />
              <input type="hidden" name="teamId" value={editingTeam.teamId} />
              <input type="hidden" name="expectedRevision" value={editingTeam.revision} />
              <TeamDialogBody>
                {emergencyAdminEdit ? (
                  <>
                    <input type="hidden" name="emergencyConfirmation" value={editingTeam.emergencyConfirmation || ''} />
                    <Alert tone="danger" title="高风险赛中调整">
                      仅允许修改成员和队长。已有成绩绑定稳定 teamId，不会转移或重算；客户端角色会立即变化。
                    </Alert>
                    <div className="rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm">
                      <p className="font-semibold text-fg">{editingTeam.name}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">{editingTeam.managementMode === 'admin' ? '管理员队伍' : '自主队伍'}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <TeamDialogField htmlFor="edit-team-name" label="队伍名称" hint="1–64 个字符">
                      <Input
                        id="edit-team-name"
                        name="name"
                        defaultValue={editingTeam.name}
                        required
                        maxLength={64}
                        className={TEAM_DIALOG_CONTROL_CLASS}
                      />
                    </TeamDialogField>
                    <TeamDialogField htmlFor="edit-team-description" label="队伍说明" hint="可选 · 最多 500 个字符">
                      <Textarea
                        id="edit-team-description"
                        name="description"
                        defaultValue={editingTeam.description}
                        maxLength={500}
                        className={TEAM_DIALOG_TEXTAREA_CLASS}
                      />
                    </TeamDialogField>
                    <TeamDialogField label="管理模式" hint="决定成员能否自行退出">
                      <SimpleSelect
                        name="managementMode"
                        defaultValue={editingTeam.managementMode}
                        options={[
                          { value: 'self', label: '自主队伍（成员可按规则退出）' },
                          { value: 'admin', label: '管理员编队（成员不可退出）' },
                        ]}
                        className={TEAM_DIALOG_CONTROL_CLASS}
                      />
                    </TeamDialogField>
                  </>
                )}
                <TeamDialogField label="成员" hint={`${editingMembers.length}/3 人`}>
                  <MultiSelect<TeamUser>
                    value={editingMembers}
                    onChange={(next) => {
                      setEditingMembers(next);
                      if (!next.some((item) => String(item._id) === editingCaptain)) setEditingCaptain(String(next[0]?._id || ''));
                    }}
                    loadOptions={searchUsers}
                    getKey={(item) => String(item._id)}
                    getLabel={domainUserSearchLabel}
                    renderChip={(item) => <span>{item.displayName || item.uname}</span>}
                    renderOption={(item) => <DomainUserSearchOption user={item} />}
                    name="memberUids"
                    maxItems={3}
                    className={TEAM_DIALOG_MULTI_SELECT_CLASS}
                    minHeight={48}
                    placeholder="按 OJ 用户、学号或姓名搜索符合资格的成员"
                  />
                </TeamDialogField>
                <TeamDialogField label="队长" hint={editingMembers.length ? '从已选成员中指定' : '请先选择成员'}>
                  <SimpleSelect
                    name="captainUid"
                    value={editingCaptain}
                    onValueChange={setEditingCaptain}
                    options={editingMembers.map((item) => ({ value: String(item._id), label: userLabel({ [item._id]: item }, item._id) }))}
                    disabled={!editingMembers.length}
                    placeholder="选择队长"
                    className={TEAM_DIALOG_CONTROL_CLASS}
                  />
                </TeamDialogField>
              </TeamDialogBody>
              <TeamDialogFooter>
                <Button type="button" variant="secondary" onClick={() => setEditingTeam(null)} className={TEAM_DIALOG_BUTTON_CLASS}>
                  取消
                </Button>
                <Button
                  type="submit"
                  variant={emergencyAdminEdit ? 'danger' : 'primary'}
                  disabled={!editingMembers.length || !editingCaptain}
                  className={TEAM_DIALOG_BUTTON_CLASS}
                >
                  {emergencyAdminEdit ? '确认赛中调整' : '保存修改'}
                </Button>
              </TeamDialogFooter>
            </form>
          ) : null}
        </TeamDialogContent>
      </Dialog>

      <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />
    </Page>
  );
}
