import { useCallback, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, Crown, LogOut, Pencil, Plus, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime } from '@/lib/format';

type R = Record<string, any>;

interface TeamUser {
  _id: number;
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
            <p className="font-mono text-[11px] text-muted-foreground">UID {uid}</p>
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
  const tdoc = data.tdoc || {};
  const tid = String(tdoc.docId || '');
  const ownTeam = (data.ownTeam || null) as TeamView | null;
  const invitations = (data.pendingInvites || []) as InviteView[];
  const users = (data.users || {}) as Record<string, TeamUser>;
  const capabilities = data.capabilities || {};
  const managedTeams = (data.teams || []) as TeamView[];
  const teamsUrl = `/contest/${encodeURIComponent(tid)}/teams`;
  const teamSearch = String(data.teamSearch || '');
  const teamPageUrl = teamSearch ? `${teamsUrl}?teamSearch=${encodeURIComponent(teamSearch)}` : teamsUrl;
  const currentUid = Number(bs.user.id);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [createSelfOpen, setCreateSelfOpen] = useState(false);
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

  const ownIsCaptain = !!ownTeam && ownTeam.captainUid === currentUid;
  const ownIsSelfManaged = ownTeam?.managementMode === 'self';

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/contest" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> 返回比赛
            </a>
            <a href={`/contest/${encodeURIComponent(tid)}`} className="text-sm text-muted-foreground hover:text-foreground">
              比赛详情
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">比赛队伍</h1>
            <Badge variant="outline">1–3 人 ACM</Badge>
            {capabilities.started ? <Badge variant="destructive">已开赛 · 普通操作冻结</Badge> : <Badge variant="secondary">赛前可调整</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{tdoc.title}</p>
        </div>
        <div className="text-sm text-muted-foreground">
          <span>开始时间</span>
          <strong className="ml-2 font-medium text-foreground">{formatDateTime(tdoc.beginAt, bs.locale)}</strong>
        </div>
      </header>

      {data.vigilRoleSyncWarning ? (
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
            <p className="font-medium">队伍已冻结</p>
            <p className="mt-1 text-muted-foreground">普通成员与队长只能查看。管理员紧急调整不会重算或转移已经取得的成绩。</p>
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">我的队伍</h2>
          <p className="text-sm text-muted-foreground">一个账号在本场比赛只能属于一支有效队伍。</p>
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
                              description: '该成员会立即失去本队身份。操作不会改变队伍已经取得的成绩。',
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
                        getLabel={(item) => `${item.displayName} ${item.uname} ${item._id}`}
                        renderChip={(item) => <span>{item.displayName || item.uname}</span>}
                        renderOption={(item) => (
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium">{item.displayName || item.uname}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {item.uname} · UID {item._id}
                            </span>
                          </span>
                        )}
                        name="inviteeUid"
                        maxItems={1}
                        placeholder="搜索 UID / 用户名 / 展示名"
                        emptyText="没有符合本场资格且未入队的用户"
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
                                description: '接受后会自动清理你在本场的其它待处理邀请，并由唯一索引确保不会同时属于两队。',
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
                <CardTitle className="text-base">开始参赛</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">你可以先创建一支队伍再邀请同伴，也可以明确以单人队参赛，之后仍能继续邀请。</p>
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
                      title: '以单人队参赛？',
                      description: '系统会立即创建由你担任队长的一人队。开赛前仍可以邀请最多两名队友。',
                      operation: 'create_solo',
                      fields: {},
                    })
                  }
                >
                  <ShieldCheck className="size-4" /> 以单人队参赛
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      {capabilities.canManage ? (
        <section className="space-y-4 border-t pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">管理员编队</h2>
              <p className="text-sm text-muted-foreground">服务端分页，共 {Number(data.teamCount || 0)} 支有效队伍。</p>
            </div>
            <Button
              type="button"
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

          <form method="get" className="flex max-w-xl gap-2">
            <Input name="teamSearch" defaultValue={teamSearch} placeholder="按队伍名称搜索" maxLength={64} />
            <Button type="submit" variant="outline">
              搜索
            </Button>
            {teamSearch ? (
              <Button asChild type="button" variant="ghost">
                <a href={teamsUrl}>清除</a>
              </Button>
            ) : null}
          </form>

          <div className="grid gap-3 lg:grid-cols-2">
            {managedTeams.map((team) => (
              <Card key={team.teamId}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {team.name}
                        <Badge variant={team.managementMode === 'admin' ? 'default' : 'secondary'}>
                          {team.managementMode === 'admin' ? '管理员' : '自主'}
                        </Badge>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">{team.description || '无说明'}</p>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">rev.{team.revision}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <MemberList team={team} users={users} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openAdminEdit(team)}>
                      <Pencil className="size-3" /> {capabilities.started ? '紧急调整' : '编辑'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
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
                </CardContent>
              </Card>
            ))}
          </div>

          {managedTeams.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">本场还没有有效队伍。</CardContent>
            </Card>
          ) : null}
          <Pagination current={Number(data.teamPage || 1)} total={Number(data.teamPageCount || 1)} baseUrl={teamPageUrl} />
        </section>
      ) : null}

      <Dialog open={createSelfOpen} onOpenChange={setCreateSelfOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建自主队伍</DialogTitle>
          </DialogHeader>
          <form method="post" className="space-y-4 p-5">
            <input type="hidden" name="operation" value="create_self" />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">队伍名称</label>
              <Input name="name" required maxLength={64} placeholder="1–64 个字符" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">说明（可选）</label>
              <Textarea name="description" maxLength={500} placeholder="训练方向、队伍介绍等" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateSelfOpen(false)}>
                取消
              </Button>
              <Button type="submit">创建并成为队长</Button>
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
                getLabel={(item) => `${item.displayName} ${item.uname} ${item._id}`}
                name="memberUids"
                maxItems={3}
                placeholder="搜索符合本场资格且未入队的用户"
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
            <DialogTitle>{capabilities.started ? '赛中紧急调整队伍' : '编辑队伍'}</DialogTitle>
          </DialogHeader>
          {editingTeam ? (
            <form method="post" className="space-y-4 p-5">
              <input type="hidden" name="operation" value="update_admin" />
              <input type="hidden" name="teamId" value={editingTeam.teamId} />
              <input type="hidden" name="expectedRevision" value={editingTeam.revision} />
              {capabilities.started ? (
                <>
                  <input type="hidden" name="emergencyConfirmation" value={editingTeam.emergencyConfirmation || ''} />
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <p className="font-medium text-destructive">高风险赛中调整</p>
                    <p className="mt-1 text-muted-foreground">仅允许修改成员和队长。已有成绩绑定稳定 teamId，不会转移或重算；客户端角色会立即变化。</p>
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
                  getLabel={(item) => `${item.displayName} ${item.uname} ${item._id}`}
                  name="memberUids"
                  maxItems={3}
                  placeholder="搜索并加入符合资格的用户"
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
                <Button type="submit" variant={capabilities.started ? 'destructive' : 'default'} disabled={!editingMembers.length || !editingCaptain}>
                  {capabilities.started ? '确认赛中调整' : '保存修改'}
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
