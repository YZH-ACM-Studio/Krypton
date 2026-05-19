/**
 * krypton-userbind admin and student pages.
 *
 * All admin pages use the AdminPage container (auto registers in the admin
 * sidebar). All student pages render free-standing.
 *
 * Pages register with the PAGE_MAP at module load (see import in resolver.tsx).
 */
import { useState } from 'react';
import {
  Building2, GraduationCap, Inbox, KeyRound, Users, UserPlus, FileDown,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Register navigation entries for the admin sidebar — happens once at module load.
registerAdminNavSection({
  key: 'userbind',
  label: '用户绑定',
  order: 30,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    { key: 'overview', label: '概览', href: '/admin/userbind', icon: Inbox, templateNames: ['admin_userbind_overview.html'] },
    { key: 'schools', label: '学校', href: '/admin/userbind/schools', icon: Building2, templateNames: ['admin_userbind_schools.html', 'admin_userbind_school_detail.html'] },
    { key: 'groups', label: '用户组', href: '/admin/userbind/groups', icon: Users, templateNames: ['admin_userbind_groups.html', 'admin_userbind_group_detail.html'] },
    { key: 'students', label: '学生', href: '/admin/userbind/students', icon: GraduationCap, templateNames: ['admin_userbind_students.html'] },
    { key: 'import', label: '批量导入', href: '/admin/userbind/students/import', icon: UserPlus, templateNames: ['admin_userbind_students_import.html'] },
    { key: 'tokens', label: '邀请令牌', href: '/admin/userbind/tokens', icon: KeyRound, templateNames: ['admin_userbind_tokens.html'] },
    { key: 'requests', label: '绑定申请', href: '/admin/userbind/requests', icon: FileDown, templateNames: ['admin_userbind_requests.html'] },
  ],
});

// ─── Admin: Overview ──────────────────────────────────────────────────────

export function AdminUserbindOverviewPage() {
  const data = useBootstrap().page.data as {
    schoolCount: number; groupCount: number; studentCount: number; pendingRequests: number;
  };
  const stats = [
    { label: '学校', value: data.schoolCount, href: '/admin/userbind/schools', icon: Building2 },
    { label: '用户组', value: data.groupCount, href: '/admin/userbind/groups', icon: Users },
    { label: '学生', value: data.studentCount, href: '/admin/userbind/students', icon: GraduationCap },
    { label: '待审申请', value: data.pendingRequests, href: '/admin/userbind/requests', icon: Inbox },
  ];
  return (
    <AdminPage title="用户绑定" description="学校、用户组、学生记录和绑定流程的管理面板。" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <a key={s.label} href={s.href}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2"><s.icon className="size-4 text-primary" /></div>
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="text-2xl font-semibold">{s.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </AdminPage>
  );
}

// ─── Admin: Schools list ──────────────────────────────────────────────────

export function AdminUserbindSchoolsPage() {
  const bs = useBootstrap();
  const schools = (bs.page.data.schools || []) as Array<{ _id: string; name: string; createdAt: string }>;
  const [newName, setNewName] = useState('');

  return (
    <AdminPage
      title="学校"
      actions={(
        <form method="post" className="flex items-end gap-2" onSubmit={() => true}>
          <input type="hidden" name="operation" value="create" />
          <Input
            name="name"
            placeholder="新学校名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="max-w-xs"
          />
          <Button type="submit" disabled={!newName.trim()}>新建</Button>
        </form>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
    >
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">名称</TableHead>
                <TableHead className="w-48">创建时间</TableHead>
                <TableHead className="w-32 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    暂无学校，使用右上角的输入框新建一个。
                  </TableCell>
                </TableRow>
              ) : (
                schools.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="pl-5 font-medium">
                      <a href={`/admin/userbind/schools/${s._id}`} className="hover:text-primary">{s.name}</a>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                        <a href={`/admin/userbind/schools/${s._id}`}>查看</a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

export function AdminUserbindSchoolDetailPage() {
  const data = useBootstrap().page.data as {
    school: { _id: string; name: string };
    groups: Array<{ _id: string; name: string }>;
    students: Array<{ _id: string; studentId: string; realName: string; boundUserId: number | null }>;
    studentTotal: number;
  };
  return (
    <AdminPage title={`学校 - ${data.school.name}`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardHeader><CardTitle className="text-base">用户组 ({data.groups.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {data.groups.map((g) => (
              <a key={g._id} href={`/admin/userbind/groups/${g._id}`}>
                <Badge variant="outline" className="cursor-pointer hover:bg-accent">{g.name}</Badge>
              </a>
            ))}
            {data.groups.length === 0 && (
              <span className="text-sm text-muted-foreground">该学校暂无用户组。</span>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">学生 ({data.studentTotal})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="w-32">绑定状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((s) => (
                <TableRow key={s._id}>
                  <TableCell className="pl-5 font-mono text-sm">{s.studentId}</TableCell>
                  <TableCell>{s.realName}</TableCell>
                  <TableCell>
                    {s.boundUserId ? (
                      <Badge variant="secondary">已绑定 UID {s.boundUserId}</Badge>
                    ) : (
                      <Badge variant="outline">未绑定</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin: Groups ────────────────────────────────────────────────────────

export function AdminUserbindGroupsPage() {
  const data = useBootstrap().page.data as {
    groups: Array<{ _id: string; name: string; schoolId: string }>;
    schools: Array<{ _id: string; name: string }>;
  };
  const schoolNameById = new Map(data.schools.map((s) => [s._id, s.name]));
  return (
    <AdminPage title="用户组" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">名称</TableHead>
                <TableHead>所属学校</TableHead>
                <TableHead className="w-32 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.map((g) => (
                <TableRow key={g._id}>
                  <TableCell className="pl-5 font-medium">{g.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{schoolNameById.get(g.schoolId) || g.schoolId}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                      <a href={`/admin/userbind/groups/${g._id}`}>查看</a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    暂无用户组。先在学校详情页或下方表单新建。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">新建用户组</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="operation" value="create" />
            <select name="schoolId" className="rounded-md border bg-background px-3 py-2 text-sm" required>
              <option value="">选择学校</option>
              {data.schools.map((s) => (<option key={s._id} value={s._id}>{s.name}</option>))}
            </select>
            <Input name="name" placeholder="用户组名称" required />
            <Button type="submit">创建</Button>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

export function AdminUserbindGroupDetailPage() {
  const data = useBootstrap().page.data as {
    group: { _id: string; name: string };
    members: Array<{ _id: string; studentId: string; realName: string }>;
  };
  return (
    <AdminPage title={`用户组 - ${data.group.name}`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardHeader><CardTitle className="text-base">成员 ({data.members.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">学号</TableHead>
                <TableHead>姓名</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m._id}>
                  <TableCell className="pl-5 font-mono text-sm">{m.studentId}</TableCell>
                  <TableCell>{m.realName}</TableCell>
                </TableRow>
              ))}
              {data.members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                    该组暂无成员。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin: Students ──────────────────────────────────────────────────────

export function AdminUserbindStudentsPage() {
  const data = useBootstrap().page.data as {
    students: Array<{ _id: string; studentId: string; realName: string; boundUserId: number | null; schoolId: string }>;
    total: number; page: number; pageSize: number;
    schools: Array<{ _id: string; name: string }>;
    filterSchoolId: string | null;
    q: string | null;
  };
  return (
    <AdminPage title="学生记录" description={`共 ${data.total} 条`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent>
          <form method="get" className="flex flex-wrap gap-2">
            <select
              name="schoolId"
              defaultValue={data.filterSchoolId || ''}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">所有学校</option>
              {data.schools.map((s) => (<option key={s._id} value={s._id}>{s.name}</option>))}
            </select>
            <Input name="q" defaultValue={data.q || ''} placeholder="搜索学号 / 姓名" className="max-w-xs" />
            <Button type="submit">筛选</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5 w-40">学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="w-40">绑定状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((s) => (
                <TableRow key={s._id}>
                  <TableCell className="pl-5 font-mono text-sm">{s.studentId}</TableCell>
                  <TableCell>{s.realName}</TableCell>
                  <TableCell>
                    {s.boundUserId ? (
                      <Badge variant="secondary">已绑定 UID {s.boundUserId}</Badge>
                    ) : (
                      <Badge variant="outline">未绑定</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

export function AdminUserbindStudentsImportPage() {
  const data = useBootstrap().page.data as {
    schools: Array<{ _id: string; name: string }>;
    report: { inserted: number; duplicates: Array<{ studentId: string; reason: string }> } | null;
  };
  return (
    <AdminPage title="批量导入学生" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">导入格式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>每行一个学生，格式：<code className="rounded bg-muted px-1.5 py-0.5">学号 姓名</code>（用空格、逗号、分号或 Tab 分隔均可）。以 <code className="rounded bg-muted px-1.5 py-0.5">#</code> 开头的行将被忽略。</p>
          <pre className="rounded-md border bg-muted/40 p-3 font-mono text-xs">
{`202301001 张三
202301002 李四
202301003 王五明
# 注释行会被忽略`}
          </pre>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <form method="post" className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">目标学校</label>
              <select name="schoolId" required className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">选择学校</option>
                {data.schools.map((s) => (<option key={s._id} value={s._id}>{s.name}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">学生名单</label>
              <textarea
                name="text"
                rows={10}
                required
                className="w-full rounded-md border bg-background p-3 font-mono text-sm"
                placeholder="202301001 张三"
              />
            </div>
            <Button type="submit">开始导入</Button>
          </form>
        </CardContent>
      </Card>
      {data.report ? (
        <Card>
          <CardHeader><CardTitle className="text-base">导入结果</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">
              成功插入 <span className="font-semibold text-green-600">{data.report.inserted}</span> 条；
              重复或失败 <span className="font-semibold text-amber-600">{data.report.duplicates.length}</span> 条。
            </p>
            {data.report.duplicates.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded border bg-muted/30 p-3 font-mono text-xs">
                {data.report.duplicates.map((d, i) => (
                  <p key={i}>{d.studentId}: {d.reason}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </AdminPage>
  );
}

// ─── Admin: Tokens ────────────────────────────────────────────────────────

export function AdminUserbindTokensPage() {
  const data = useBootstrap().page.data as {
    tokens: Array<{ _id: string; studentRecordId: string; used: boolean; usedBy: number | null; createdAt: string; expiresAt: string | null }>;
  };
  return (
    <AdminPage title="邀请令牌" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">令牌 (前 16 位)</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>过期时间</TableHead>
                <TableHead className="pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tokens.map((t) => (
                <TableRow key={t._id}>
                  <TableCell className="pl-5 font-mono text-xs">{t._id.slice(0, 16)}…</TableCell>
                  <TableCell>
                    {t.used ? (
                      <Badge variant="secondary">已使用 (UID {t.usedBy})</Badge>
                    ) : (
                      <Badge variant="outline">未使用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{new Date(t.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{t.expiresAt ? new Date(t.expiresAt).toLocaleString() : '永久'}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {!t.used ? (
                      <form method="post" className="inline-block">
                        <input type="hidden" name="operation" value="revoke" />
                        <input type="hidden" name="tokenId" value={t._id} />
                        <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                          撤销
                        </Button>
                      </form>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {data.tokens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    暂无邀请令牌。在学生记录详情页可以为单个学生生成令牌。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin: Binding requests ──────────────────────────────────────────────

export function AdminUserbindRequestsPage() {
  const data = useBootstrap().page.data as {
    requests: Array<{
      _id: string; userId: number; studentIdInput: string; realNameInput: string;
      status: 'pending' | 'approved' | 'rejected'; createdAt: string;
      claimTempUserId: number | null; rejectReason: string | null;
    }>;
    total: number; page: number; status?: string;
  };
  return (
    <AdminPage title="绑定申请" description={`共 ${data.total} 条`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant={!data.status ? 'default' : 'outline'} size="sm"><a href="/admin/userbind/requests">全部</a></Button>
          <Button asChild variant={data.status === 'pending' ? 'default' : 'outline'} size="sm"><a href="/admin/userbind/requests?status=pending">待审核</a></Button>
          <Button asChild variant={data.status === 'approved' ? 'default' : 'outline'} size="sm"><a href="/admin/userbind/requests?status=approved">已通过</a></Button>
          <Button asChild variant={data.status === 'rejected' ? 'default' : 'outline'} size="sm"><a href="/admin/userbind/requests?status=rejected">已拒绝</a></Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">申请人</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>提交时间</TableHead>
                <TableHead className="pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.requests.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="pl-5 font-mono text-xs">UID {r.userId}</TableCell>
                  <TableCell className="font-mono text-sm">{r.studentIdInput}</TableCell>
                  <TableCell>{r.realNameInput}</TableCell>
                  <TableCell>
                    {r.claimTempUserId ? (
                      <Badge variant="outline" className="text-[10px]">认领临时账号 UID {r.claimTempUserId}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">绑定</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.status === 'pending' && <Badge>待审核</Badge>}
                    {r.status === 'approved' && <Badge variant="secondary">通过</Badge>}
                    {r.status === 'rejected' && (
                      <Badge variant="destructive" title={r.rejectReason || ''}>拒绝</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{new Date(r.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {r.status === 'pending' && (
                      <div className="inline-flex gap-1">
                        <form method="post" className="inline-block">
                          <input type="hidden" name="operation" value="approve" />
                          <input type="hidden" name="requestId" value={r._id} />
                          <Button type="submit" size="sm" className="h-7 text-xs">通过</Button>
                        </form>
                        <form method="post" className="inline-block" onSubmit={(e) => {
                          const reason = window.prompt('拒绝理由（可选）：') ?? '';
                          const reasonInput = e.currentTarget.querySelector('input[name=reason]') as HTMLInputElement | null;
                          if (reasonInput) reasonInput.value = reason;
                        }}>
                          <input type="hidden" name="operation" value="reject" />
                          <input type="hidden" name="requestId" value={r._id} />
                          <input type="hidden" name="reason" value="" />
                          <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">拒绝</Button>
                        </form>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    暂无绑定申请。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Student-facing pages ─────────────────────────────────────────────────

export function UserBindPage() {
  const data = useBootstrap().page.data as {
    schools: Array<{ _id: string; name: string }>;
    myRequests: Array<{ _id: string; studentIdInput: string; realNameInput: string; status: string; rejectReason: string | null }>;
    alreadyBound: boolean;
    currentStudentId: string | null;
    currentRealName: string | null;
  };

  if (data.alreadyBound) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-8">
        <Card>
          <CardHeader><CardTitle>身份已绑定</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>你的账号已经绑定到学号 <span className="font-mono font-semibold">{data.currentStudentId}</span></p>
            <p>姓名：<span className="font-semibold">{data.currentRealName}</span></p>
            <p className="text-muted-foreground">绑定后无法修改。如需变更，请联系管理员。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">绑定学生身份</h1>
        <p className="text-sm text-muted-foreground">
          提交学号和姓名后，由管理员审核通过后完成绑定。
        </p>
      </div>
      <Card>
        <CardContent>
          <form method="post" className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">学校</label>
              <select name="schoolId" required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">选择学校</option>
                {data.schools.map((s) => (<option key={s._id} value={s._id}>{s.name}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">学号</label>
              <Input name="studentId" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">姓名</label>
              <Input name="realName" required />
            </div>
            <Button type="submit">提交申请</Button>
          </form>
        </CardContent>
      </Card>
      {data.myRequests.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">我的申请记录</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.myRequests.map((r) => (
              <div key={r._id} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div>
                  <span className="font-mono">{r.studentIdInput}</span>{' '}
                  <span className="text-muted-foreground">{r.realNameInput}</span>
                </div>
                <div>
                  {r.status === 'pending' && <Badge>待审核</Badge>}
                  {r.status === 'approved' && <Badge variant="secondary">已通过</Badge>}
                  {r.status === 'rejected' && (
                    <Badge variant="destructive" title={r.rejectReason || ''}>已拒绝</Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function UserBindLandingPage() {
  const data = useBootstrap().page.data as { token: string; signedIn: boolean };
  return (
    <div className="mx-auto max-w-md space-y-4 py-8">
      <Card>
        <CardHeader><CardTitle>邀请绑定</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            点击下方按钮，将你的账号与邀请方提供的学生信息进行绑定。
          </p>
          <p className="font-mono text-xs text-muted-foreground">token: {data.token.slice(0, 16)}…</p>
          {data.signedIn ? (
            <form method="post">
              <Button type="submit">确认绑定</Button>
            </form>
          ) : (
            <Button asChild>
              <a href={`/login?redirect=${encodeURIComponent(`/bind/${data.token}`)}`}>登录后绑定</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function UserBindSuccessPage() {
  const data = useBootstrap().page.data as {
    studentRecord: { studentId: string; realName: string };
    school: { name: string };
  };
  return (
    <div className="mx-auto max-w-md space-y-4 py-8">
      <Card>
        <CardHeader><CardTitle>绑定成功</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>已绑定到 <span className="font-semibold">{data.school.name}</span></p>
          <p>学号：<span className="font-mono">{data.studentRecord.studentId}</span></p>
          <p>姓名：<span className="font-semibold">{data.studentRecord.realName}</span></p>
        </CardContent>
      </Card>
    </div>
  );
}

export function UserBindClaimPage() {
  const data = useBootstrap().page.data as { currentStudentId: string | null };
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-6">
      <h1 className="text-xl font-semibold">认领临时账号</h1>
      <p className="text-sm text-muted-foreground">
        如果你之前以临时账号参加过考试，可以在这里申请将那些考试记录归到你当前账号下。
        提交后由管理员审核。
      </p>
      <Card>
        <CardContent>
          <form method="post" className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">临时账号 UID</label>
              <Input name="tempUserId" type="number" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">学校 ID</label>
              <Input name="schoolId" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">考试时的学号</label>
              <Input name="studentId" defaultValue={data.currentStudentId || ''} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">考试时的姓名</label>
              <Input name="realName" required />
            </div>
            <Button type="submit">提交认领申请</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
