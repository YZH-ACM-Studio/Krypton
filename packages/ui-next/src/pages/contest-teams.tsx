import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Crown, Lock, LogOut, Pencil, Plus, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel } from '@/components/domain-user-search';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { evaluateSelfTeamName } from '@/lib/contest-team-form';
import { formatDateTime } from '@/lib/format';

type R = Record<string, any>;

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

function ConfirmDialog({ action, onClose }: { action: ConfirmAction | null; onClose: () => void }) {
  return (
    <Dialog open={!!action} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action?.title || '确认操作'}</DialogTitle>
        </DialogHeader>
        <form method="post" className="space-y-4 p-5">
          <p className="text-sm leading-6 text-muted-foreground">{action?.description}</p>
          <input type="hidden" name="operation" value={action?.operation || ''} />
          {Object.entries(action?.fields || {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant={action?.destructive ? 'destructive' : 'default'}>
              确认
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberList({ team, users, actions }: { team: TeamView; users: Record<string, TeamUser>; actions?: (uid: number) => ReactNode }) {
  return (
    <div className="divide-y rounded-xl border bg-background/60">
      {team.memberUids.map((uid) => (
        <div key={uid} className="flex min-h-14 items-center gap-3 px-3 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {userLabel(users, uid).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{userLabel(users, uid)}</span>
              {team.captainUid === uid ? (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Crown className="size-3" /> 队长
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {studentIdentity(teamUser(users, uid)) || '未绑定学生档案'}
              <span className="font-mono"> · UID {uid}</span>
            </p>
          </div>
          {actions?.(uid)}
        </div>
      ))}
    </div>
  );
}

export function ContestTeamsPage() {
  const bs = useBootstrap();
  const data = bs.page.data as R;
  const isBatch = data.workspaceKind === 'batch';
  const tdoc = data.tdoc || {};
  const batch = data.batch || {};
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
      const response = await fetch(`${teamsUrl}?search=${encodeURIComponent(value)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Team user search failed (${response.status}).`);
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

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={isBatch ? '/teams' : '/contest'}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> {isBatch ? '返回队伍中心' : '返回比赛'}
            </a>
            {!isBatch ? (
              <a href={`/contest/${encodeURIComponent(tid)}`} className="text-sm text-muted-foreground hover:text-foreground">
                比赛详情
              </a>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{isBatch ? '赛前组队' : '比赛队伍'}</h1>
            <Badge variant="outline">1–3 人 ACM</Badge>
            {capabilities.started ? (
              <Badge variant={isBatch ? 'outline' : 'destructive'}>{isBatch ? '批次已关闭 · 可绑定比赛' : '已开赛 · 普通操作冻结'}</Badge>
            ) : (
              <Badge variant="secondary">{isBatch ? '开放组队' : '赛前可调整'}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{isBatch ? batch.name : tdoc.title}</p>
          {isBatch && batch.description ? <p className="max-w-2xl text-sm text-muted-foreground">{batch.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <div>
            <span>{isBatch ? (batch.closedAt ? '关闭时间' : '创建时间') : '开始时间'}</span>
            <strong className="ml-2 font-medium text-foreground">
              {formatDateTime(isBatch ? batch.closedAt || batch.createdAt : tdoc.beginAt, bs.locale)}
            </strong>
          </div>
          {isBatch && capabilities.canClose ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setConfirmAction({
                  title: '关闭这个组队批次？',
                  description: '关闭后普通组队操作全部冻结，阵容可在创建团队 ACM 比赛时生成独立快照。关闭后不再重新开放。',
                  operation: 'close',
                  fields: { expectedRevision: Number(batch.revision || 0) },
                })
              }
            >
              <Lock className="size-4" /> 关闭批次
            </Button>
          ) : null}
        </div>
      </header>

      {!isBatch && data.vigilRoleSyncWarning ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div>
            <p className="font-medium">队伍已保存，但客户端角色刷新失败</p>
            <p className="mt-1 text-muted-foreground">OJ 提交权限已经按新队伍生效；请让受影响客户端重新连接，或检查 Vigil Server 后再次调整。</p>
          </div>
        </div>
      ) : null}

      {capabilities.started ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">{isBatch ? '组队批次已关闭' : '队伍已冻结'}</p>
            <p className="mt-1 text-muted-foreground">
              {isBatch ? '当前阵容只读，可作为后续团队 ACM 比赛的快照来源。' : '普通成员与队长只能查看。管理员紧急调整不会重算或转移已经取得的成绩。'}
            </p>
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">我的队伍</h2>
          <p className="text-sm text-muted-foreground">一个账号在{isBatch ? '当前组队批次' : '本场比赛'}只能属于一支有效队伍。</p>
        </div>

        {ownTeam ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      {ownTeam.name}
                      <Badge variant={ownTeam.managementMode === 'admin' ? 'default' : 'secondary'}>
                        {ownTeam.managementMode === 'admin' ? '管理员编队' : '自主队伍'}
                      </Badge>
                    </CardTitle>
                    <p className="mt-2 text-sm text-muted-foreground">{ownTeam.description || '暂无队伍说明'}</p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">rev.{ownTeam.revision}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <MemberList
                  team={ownTeam}
                  users={users}
                  actions={(uid) =>
                    capabilities.canEditOwn && ownIsCaptain && ownIsSelfManaged && uid !== currentUid ? (
                      <div className="flex items-center gap-1">
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
                          <Crown className="size-3" /> 转让
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
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
                          <X className="size-3" /> 移除
                        </Button>
                      </div>
                    ) : null
                  }
                />

                {capabilities.canLeave ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      {ownIsCaptain && ownTeam.memberUids.length > 1 ? '队长退出前必须先转让队长。' : '退出后可接受其它队伍邀请。'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
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
                      <LogOut className="size-4" /> {ownTeam.memberUids.length === 1 ? '停用队伍' : '退出队伍'}
                    </Button>
                  </div>
                ) : ownTeam.managementMode === 'admin' && !capabilities.started ? (
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">管理员编队的成员不能自行退出或调整阵容。</p>
                ) : null}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {capabilities.canEditOwn ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Pencil className="size-4" /> 队伍信息
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form method="post" className="space-y-3">
                      <input type="hidden" name="operation" value="update_info" />
                      <input type="hidden" name="teamId" value={ownTeam.teamId} />
                      <input type="hidden" name="expectedRevision" value={ownTeam.revision} />
                      <Input name="name" defaultValue={ownTeam.name} required maxLength={64} placeholder="队伍名称" />
                      <Textarea name="description" defaultValue={ownTeam.description} maxLength={500} placeholder="队伍说明（可选）" />
                      <Button type="submit" className="w-full">
                        保存队伍信息
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              ) : null}

              {capabilities.canInvite ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserPlus className="size-4" /> 邀请队员
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form method="post" className="space-y-3">
                      <input type="hidden" name="operation" value="invite" />
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
                      <Button type="submit" className="w-full" disabled={inviteTargets.length !== 1}>
                        发送邀请
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">待处理邀请</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {invitations.length ? (
                  invitations.map((invite) => (
                    <div key={invite.inviteId} className="rounded-xl border bg-background/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{invite.teamName}</p>
                            <Badge variant="outline">{invite.memberUids.length}/3 人</Badge>
                            {!invite.canAccept ? <Badge variant="destructive">邀请已失效</Badge> : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            邀请人：{userLabel(users, invite.inviterUid)} · {formatDateTime(invite.createdAt, bs.locale)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
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
                            size="sm"
                            variant="outline"
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
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">目前没有发给你的待处理邀请。</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{isBatch ? '开始组队' : '开始参赛'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">你可以先创建一支队伍再邀请同伴，也可以明确创建单人队，之后仍能继续邀请。</p>
                <Button type="button" className="w-full" disabled={!capabilities.canCreate} onClick={() => setCreateSelfOpen(true)}>
                  <Users className="size-4" /> 创建队伍
                </Button>
                <Button
                  type="button"
                  className="w-full"
                  variant="outline"
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
                  <ShieldCheck className="size-4" /> {isBatch ? '创建单人队' : '以单人队参赛'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      {capabilities.canManage ? (
        <section className="space-y-4 border-t pt-6">
          <div className="overflow-hidden rounded-[24px] bg-card shadow-[0_18px_50px_-34px_rgba(0,0,0,0.55)] ring-1 ring-foreground/10">
            <div className="space-y-4 border-b border-border/70 px-4 py-5 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">管理员编队</h2>
                    <Badge variant="secondary" className="rounded-full px-2.5 font-mono text-[11px]">
                      {Number(data.teamCount || 0)} 支
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">每页 20 支，按队伍快速检查阵容与学生身份。</p>
                </div>
                <Button
                  type="button"
                  className="h-10 rounded-xl transition-[scale,background-color,box-shadow] duration-150 active:scale-[0.96] motion-reduce:transition-none"
                  disabled={capabilities.started}
                  onClick={() => {
                    setAdminCreateMembers([]);
                    setAdminCreateCaptain('');
                    setAdminCreateOpen(true);
                  }}
                >
                  <Plus className="size-4" /> 新建管理员队伍
                </Button>
              </div>

              <form method="get" className="flex max-w-2xl flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    name="teamSearch"
                    defaultValue={teamSearch}
                    placeholder="按队伍名称搜索"
                    maxLength={64}
                    className="h-10 rounded-xl border-border/70 bg-muted/35 pl-9 shadow-none"
                  />
                </div>
                <Button type="submit" variant="outline" className="h-10 rounded-xl px-5 active:scale-[0.96]">
                  搜索
                </Button>
                {teamSearch ? (
                  <Button asChild type="button" variant="ghost" className="h-10 rounded-xl px-4 active:scale-[0.96]">
                    <a href={teamsUrl}>清除</a>
                  </Button>
                ) : null}
              </form>
            </div>

            <div className="hidden grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_10.5rem] gap-5 bg-muted/25 px-5 py-2.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground xl:grid">
              <span>队伍</span>
              <span>成员与绑定身份</span>
              <span className="text-right">操作</span>
            </div>

            <div className="divide-y divide-border/65">
              {managedTeams.map((team) => (
                <article
                  key={team.teamId}
                  className="grid gap-4 px-4 py-4 transition-[background-color] duration-150 hover:bg-muted/20 sm:px-5 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(24rem,1.7fr)_10.5rem] xl:items-center xl:gap-5"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{team.name}</h3>
                      <Badge variant={team.managementMode === 'admin' ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                        {team.managementMode === 'admin' ? '管理员' : '自主'}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{team.description || '无说明'}</p>
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                      {team.memberUids.length}/3 人 · rev.{team.revision}
                    </p>
                  </div>

                  <div className="grid gap-1.5 sm:grid-cols-3">
                    {team.memberUids.map((uid) => {
                      const member = teamUser(users, uid);
                      return (
                        <div key={uid} className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/45 px-2.5 py-2 ring-1 ring-foreground/[0.06]">
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-background text-[10px] font-semibold shadow-sm ring-1 ring-foreground/10">
                            {userLabel(users, uid).slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-medium">{userLabel(users, uid)}</span>
                              {team.captainUid === uid ? <Crown className="size-3 shrink-0 text-amber-500" aria-label="队长" /> : null}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {studentIdentity(member) || '未绑定学生档案'} · UID {uid}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-2 xl:justify-self-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl px-3 transition-[scale,background-color,border-color] duration-150 active:scale-[0.96] motion-reduce:transition-none"
                      disabled={capabilities.started && !capabilities.canEmergencyEdit}
                      onClick={() => openAdminEdit(team)}
                    >
                      <Pencil className="size-3.5" /> {emergencyAdminEdit ? '紧急调整' : capabilities.started ? '已冻结' : '编辑'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-10 rounded-xl px-3 text-destructive transition-[scale,background-color,color] duration-150 hover:bg-destructive/10 hover:text-destructive active:scale-[0.96] motion-reduce:transition-none"
                      disabled={capabilities.started}
                      onClick={() =>
                        setConfirmAction({
                          title: `停用「${team.name}」？`,
                          description: '队伍不会被物理删除，但成员会被释放，可以重新加入其它队伍。',
                          operation: 'deactivate',
                          fields: { teamId: team.teamId, expectedRevision: team.revision },
                          destructive: true,
                        })
                      }
                    >
                      停用
                    </Button>
                  </div>
                </article>
              ))}
            </div>

            {managedTeams.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <Users className="mx-auto size-8 text-muted-foreground/45" />
                <p className="mt-3 text-sm font-medium">{teamSearch ? '没有匹配的队伍' : isBatch ? '本批次还没有有效队伍' : '本场还没有有效队伍'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{teamSearch ? '换一个队伍名称继续搜索。' : '创建后会在这里集中管理成员与队长。'}</p>
              </div>
            ) : null}
          </div>
          <Pagination current={Number(data.teamPage || 1)} total={Number(data.teamPageCount || 1)} baseUrl={teamPageUrl} />
        </section>
      ) : null}

      <Dialog open={createSelfOpen} onOpenChange={handleCreateSelfOpenChange}>
        <DialogContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-self-dialog-title"
          aria-describedby="create-self-dialog-description"
          className="sm:w-[30rem] rounded-[28px] border-0 bg-background/95 shadow-[0_32px_90px_-34px_rgba(0,0,0,0.72),0_14px_36px_-22px_rgba(0,0,0,0.52)] ring-1 ring-foreground/10 backdrop-blur-xl"
        >
          <div className="flex items-start gap-4 px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15">
              <Crown className="size-5" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <DialogTitle id="create-self-dialog-title" className="text-balance text-xl font-semibold leading-tight tracking-tight">
                创建自主队伍
              </DialogTitle>
              <p id="create-self-dialog-description" className="mt-1.5 text-pretty text-sm leading-6 text-muted-foreground">
                创建后你将成为队长，可以继续邀请至多两名队员。
              </p>
            </div>
            <button
              type="button"
              aria-label="关闭创建队伍弹窗"
              title="关闭"
              onClick={() => handleCreateSelfOpenChange(false)}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/65 text-muted-foreground ring-1 ring-foreground/10 transition-[scale,background-color,color] duration-150 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] motion-reduce:transition-none"
            >
              <X className="size-4" />
            </button>
          </div>
          <form
            method="post"
            noValidate
            onSubmit={handleCreateSelfSubmit}
            className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-6 pb-6 pt-1 sm:px-7 sm:pb-7"
          >
            <input type="hidden" name="operation" value="create_self" />
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="create-self-name" className="text-sm font-semibold">
                  队伍名称
                </label>
                <span className="text-xs text-muted-foreground">1–64 个字符</span>
              </div>
              <Input
                id="create-self-name"
                name="name"
                required
                maxLength={64}
                autoFocus
                aria-invalid={!!createSelfNameError}
                aria-describedby={createSelfNameError ? 'create-self-name-error' : undefined}
                placeholder="给队伍起一个名字"
                onChange={(event) => {
                  if (createSelfNameError && event.currentTarget.value.trim()) setCreateSelfNameError('');
                }}
                className={`h-12 rounded-[14px] border-border/70 bg-muted/30 px-4 py-3 text-base shadow-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/10 sm:text-sm dark:bg-white/[0.035] ${
                  createSelfNameError ? 'border-destructive/60 focus-visible:border-destructive/70 focus-visible:ring-destructive/10' : ''
                }`}
              />
              <div className="min-h-5">
                {createSelfNameError ? (
                  <p id="create-self-name-error" role="alert" className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="size-3.5" />
                    {createSelfNameError}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="create-self-description" className="text-sm font-semibold">
                  队伍说明
                </label>
                <span className="text-xs text-muted-foreground">可选 · 最多 500 个字符</span>
              </div>
              <Textarea
                id="create-self-description"
                name="description"
                maxLength={500}
                placeholder="训练方向、队伍介绍等"
                className="min-h-28 resize-none rounded-2xl border-border/70 bg-muted/30 px-4 py-3 text-base leading-6 shadow-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/10 sm:text-sm dark:bg-white/[0.035]"
              />
            </div>
            <div className="grid grid-cols-[0.8fr_1.4fr] gap-2.5 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleCreateSelfOpenChange(false)}
                className="h-11 rounded-[14px] bg-muted/70 shadow-none transition-[scale,background-color,color] duration-150 ease-out hover:bg-muted active:scale-[0.96] motion-reduce:transition-none"
              >
                取消
              </Button>
              <Button
                type="submit"
                className="h-11 rounded-[14px] shadow-lg shadow-primary/20 transition-[scale,background-color,box-shadow] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
              >
                创建并成为队长
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={adminCreateOpen} onOpenChange={setAdminCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>新建管理员队伍</DialogTitle>
          </DialogHeader>
          <form method="post" className="space-y-4 p-5">
            <input type="hidden" name="operation" value="create_admin" />
            <Input name="name" required maxLength={64} placeholder="队伍名称" />
            <Textarea name="description" maxLength={500} placeholder="队伍说明（可选）" />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">成员（1–3 人）</label>
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
                placeholder={isBatch ? '按 OJ 用户、学号或姓名搜索可加入成员' : '按 OJ 用户、学号或姓名搜索符合资格的成员'}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">队长</label>
              <SimpleSelect
                name="captainUid"
                value={adminCreateCaptain}
                onValueChange={setAdminCreateCaptain}
                options={adminCreateMembers.map((item) => ({ value: String(item._id), label: userLabel({ [item._id]: item }, item._id) }))}
                disabled={!adminCreateMembers.length}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAdminCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!adminCreateMembers.length || !adminCreateCaptain}>
                创建队伍
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingTeam} onOpenChange={(open) => !open && setEditingTeam(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{emergencyAdminEdit ? '赛中紧急调整队伍' : '编辑队伍'}</DialogTitle>
          </DialogHeader>
          {editingTeam ? (
            <form method="post" className="space-y-4 p-5">
              <input type="hidden" name="operation" value="update_admin" />
              <input type="hidden" name="teamId" value={editingTeam.teamId} />
              <input type="hidden" name="expectedRevision" value={editingTeam.revision} />
              {emergencyAdminEdit ? (
                <>
                  <input type="hidden" name="emergencyConfirmation" value={editingTeam.emergencyConfirmation || ''} />
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <p className="font-medium text-destructive">高风险赛中调整</p>
                    <p className="mt-1 text-muted-foreground">
                      仅允许修改成员和队长。已有成绩绑定稳定 teamId，不会转移或重算；客户端角色会立即变化。
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                    <p className="font-medium">{editingTeam.name}</p>
                    <p className="text-xs text-muted-foreground">{editingTeam.managementMode === 'admin' ? '管理员队伍' : '自主队伍'}</p>
                  </div>
                </>
              ) : (
                <>
                  <Input name="name" defaultValue={editingTeam.name} required maxLength={64} />
                  <Textarea name="description" defaultValue={editingTeam.description} maxLength={500} />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">管理模式</label>
                    <SimpleSelect
                      name="managementMode"
                      defaultValue={editingTeam.managementMode}
                      options={[
                        { value: 'self', label: '自主队伍（成员可按规则退出）' },
                        { value: 'admin', label: '管理员编队（成员不可退出）' },
                      ]}
                    />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">成员（1–3 人）</label>
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
                  placeholder="按 OJ 用户、学号或姓名搜索符合资格的成员"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">队长</label>
                <SimpleSelect
                  name="captainUid"
                  value={editingCaptain}
                  onValueChange={setEditingCaptain}
                  options={editingMembers.map((item) => ({ value: String(item._id), label: userLabel({ [item._id]: item }, item._id) }))}
                  disabled={!editingMembers.length}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingTeam(null)}>
                  取消
                </Button>
                <Button type="submit" variant={emergencyAdminEdit ? 'destructive' : 'default'} disabled={!editingMembers.length || !editingCaptain}>
                  {emergencyAdminEdit ? '确认赛中调整' : '保存修改'}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />
    </motion.div>
  );
}
