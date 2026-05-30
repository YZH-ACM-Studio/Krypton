/**
 * krypton-userbind admin and student pages.
 *
 * All admin pages use the AdminPage container (auto registers in the admin
 * sidebar). All student pages render free-standing.
 *
 * Pages register with the PAGE_MAP at module load (see import in resolver.tsx).
 */
import { type ReactNode, useState } from 'react';
import {
  AlertCircle, Building2, ChevronRight, Copy, FileDown, GraduationCap, Inbox, KeyRound,
  LinkIcon, ListChecks, Mail, Plus, RefreshCw, Search, ShieldCheck, UserCheck, Users, UserPlus,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { FormField, FormRow, FormSection } from '@/components/ui/form';
import { ImportResultPanel, RosterImporter, type ImportResult } from '@/components/userbind/roster-importer';
import { DateTime } from '@/components/ui/datetime';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';

// Register navigation entries for the admin sidebar — happens once at module load.
// (overview was dropped; /admin/userbind still resolves server-side but doesn't
// surface in the nav since the stats card duplicated info reachable elsewhere.)
registerAdminNavSection({
  key: 'userbind',
  label: '用户绑定',
  order: 30,
  requiredPriv: PRIV.PRIV_EDIT_SYSTEM,
  items: [
    { key: 'schools', label: '学校', href: '/admin/userbind/schools', icon: Building2, templateNames: ['admin_userbind_schools.html', 'admin_userbind_school_detail.html'] },
    { key: 'groups', label: '班级/队伍', href: '/admin/userbind/groups', icon: Users, templateNames: ['admin_userbind_groups.html', 'admin_userbind_group_detail.html'] },
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <a key={s.label} href={s.href}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="p-5">
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
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <AdminPage
      title="学校"
      actions={(
        <Button onClick={() => setCreateOpen(true)} className="gap-1">
          <Plus className="size-3.5" />
          新建学校
        </Button>
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
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    暂无学校，点击右上角「新建学校」开始创建。
                  </TableCell>
                </TableRow>
              ) : (
                schools.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="pl-5 font-medium">
                      <a href={`/admin/userbind/schools/${s._id}`} className="hover:text-primary">{s.name}</a>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground"><DateTime value={s.createdAt} /></TableCell>
                    <TableCell>
                      <TableActions>
                        <TableAction href={`/admin/userbind/schools/${s._id}`}>查看</TableAction>
                      </TableActions>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateSchoolDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </AdminPage>
  );
}

function CreateSchoolDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [newName, setNewName] = useState('');
  const [withRoster, setWithRoster] = useState(false);
  const [roster, setRoster] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[560px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>新建学校</DialogTitle>
        </DialogHeader>
        <form method="post" className="flex flex-col">
          <ScrollArea className="h-[55vh]" viewportClassName="space-y-4 p-5">
            <input type="hidden" name="operation" value="create" />
            <FormField label="学校名称" required htmlFor="school-name">
              <Input
                id="school-name"
                name="name"
                placeholder="如 中国民航大学"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                autoFocus
              />
            </FormField>
            <FormField label="同时导入学生名单（可选）">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={withRoster}
                    onChange={(e) => setWithRoster(e.target.checked)}
                   />
                  创建后立即导入一份学生名单
                </label>
                {withRoster && (
                  <textarea
                    name="initialRoster"
                    rows={6}
                    spellCheck={false}
                    value={roster}
                    onChange={(e) => setRoster(e.target.value)}
                    className="w-full rounded-md border bg-background p-3 font-mono text-sm"
                    placeholder={'每行 学号 姓名，如：\n202301001 张三\n202301002 李四'}
                  />
                )}
              </div>
            </FormField>
          </ScrollArea>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={!newName.trim()}>创建学校</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Scrollable, searchable list of a school's user groups. Replaces the old
 * flex-wrap of badges so a school with 50+ groups doesn't overflow the page.
 */
function SchoolGroupsList({
  schoolId, groups, total, page, pageSize, query,
}: {
  schoolId: string;
  groups: Array<{ _id: string; name: string; memberCount: number }>;
  total: number;
  page: number;
  pageSize: number;
  query: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>用户组 ({total})</span>
          <Button asChild size="sm" variant="outline" className="gap-1">
            <a href={`/admin/userbind/groups?schoolId=${schoolId}`}>
              <Users className="size-3.5" />在用户组页新建
            </a>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form method="get" action={`/admin/userbind/schools/${schoolId}`} className="flex flex-wrap gap-2">
          <input type="hidden" name="tab" value="groups" />
          <Input
            name="groupQ"
            placeholder="搜索用户组名称"
            defaultValue={query}
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" className="gap-1">
            <Search className="size-3.5" />搜索
          </Button>
        </form>
        {groups.length === 0 && !query ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            该学校暂无用户组。前往「用户组」页面创建一个。
          </div>
        ) : (
          <>
            <ScrollArea className="max-h-80 rounded-md border bg-muted/10">
              {groups.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  没有匹配「{query}」的用户组
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {groups.map((g) => (
                    <li key={g._id}>
                      <a
                        href={`/admin/userbind/groups/${g._id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40"
                      >
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate text-sm font-medium">{g.name}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px] font-mono">
                          {g.memberCount} 人
                        </Badge>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
            {pageCount > 1 && (
              <div className="flex justify-center">
                <Pagination
                  current={page}
                  total={pageCount}
                  baseUrl={`/admin/userbind/schools/${schoolId}?tab=groups&groupQ=${encodeURIComponent(query)}&`}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminUserbindSchoolDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    school: { _id: string; name: string };
    groups: Array<{ _id: string; name: string; memberCount: number }>;
    groupTotal: number;
    groupPage: number;
    groupLimit: number;
    groupQuery: string;
    students: Array<{ _id: string; studentId: string; realName: string; boundUserId: number | null }>;
    studentTotal: number;
    studentPage: number;
    studentLimit: number;
    studentQuery: string;
    schoolTokens: Array<{ _id: string; createdAt: string; expiresAt: string | null }>;
    importSearchResults: Array<{ _id: string; studentId: string; realName: string; boundUserId: number | null }>;
    importQ: string;
    tab: 'students' | 'import' | 'groups' | 'links';
    importReport: ImportResult | null;
  };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const activeTab = data.tab || 'students';
  const studentPage = data.studentPage || 1;
  const studentLimit = data.studentLimit || 50;
  const studentPageCount = Math.max(1, Math.ceil((data.studentTotal || 0) / studentLimit));
  return (
    <AdminPage title={`学校 - ${data.school.name}`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <MiniTabs
        items={[
          { value: 'students', label: '学生', count: data.studentTotal || 0, icon: GraduationCap, href: `/admin/userbind/schools/${data.school._id}?tab=students` },
          { value: 'import', label: '导入', icon: UserPlus, href: `/admin/userbind/schools/${data.school._id}?tab=import` },
          { value: 'groups', label: '用户组', count: data.groupTotal || 0, icon: Users, href: `/admin/userbind/schools/${data.school._id}?tab=groups` },
          { value: 'links', label: '邀请链接', count: (data.schoolTokens || []).length, icon: LinkIcon, href: `/admin/userbind/schools/${data.school._id}?tab=links` },
        ]}
        value={activeTab}
      />

      {activeTab === 'students' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
              <span>学生 ({data.studentTotal})</span>
              <form method="get" action={`/admin/userbind/schools/${data.school._id}`} className="flex gap-2">
                <input type="hidden" name="tab" value="students" />
                <Input name="q" defaultValue={data.studentQuery || ''} placeholder="搜索学号 / 姓名" className="w-56" />
                <Button type="submit" variant="outline" className="gap-1">
                  <Search className="size-3.5" />搜索
                </Button>
              </form>
            </CardTitle>
          </CardHeader>
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
                {data.students.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                      {data.studentQuery ? `没有匹配「${data.studentQuery}」的学生` : '暂无学生。使用「导入」页添加。'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          {studentPageCount > 1 && (
            <div className="flex justify-center border-t px-5 py-3">
              <Pagination
                current={studentPage}
                total={studentPageCount}
                baseUrl={`/admin/userbind/schools/${data.school._id}?tab=students&q=${encodeURIComponent(data.studentQuery || '')}&`}
              />
            </div>
          )}
        </Card>
      )}

      {activeTab === 'import' && (
        <>
          <RosterImporter
            title="导入学生到本校"
            description="批量导入会先建档；搜索导入会从已有 OJ 用户中选择，并在学号姓名精确匹配后直接绑定。"
            action={`/admin/userbind/schools/${data.school._id}`}
            hiddenFields={{ operation: 'importText' }}
            enableSearch
            searchUrl={`/admin/userbind/schools/${data.school._id}`}
            searchHiddenFields={{ tab: 'import' }}
            searchParamName="importQ"
            searchResults={data.importSearchResults || []}
            searchQuery={data.importQ || ''}
            searchSelectFieldName="userIds"
            searchResultHint="搜索已有 OJ 用户，选择后会导入并自动绑定"
            submitLabel="导入到学校"
          />
          {data.importReport && <ImportResultPanel report={data.importReport} />}
        </>
      )}

      {activeTab === 'groups' && (
        <SchoolGroupsList
          schoolId={data.school._id}
          groups={data.groups}
          total={data.groupTotal || 0}
          page={data.groupPage || 1}
          pageSize={data.groupLimit || 20}
          query={data.groupQuery || ''}
        />
      )}

      {activeTab === 'links' && (
        <Card>
          <CardHeader className="px-5 pb-3 pt-5">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2"><LinkIcon className="size-4" />学校邀请链接</span>
              <form method="post" className="flex items-end gap-2">
                <input type="hidden" name="operation" value="generateLink" />
                <Input name="ttlDays" type="number" placeholder="有效天数（留空=永久）" className="max-w-[160px]" />
                <Button type="submit" size="sm">生成新链接</Button>
              </form>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {(data.schoolTokens || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有该学校的邀请链接。生成一个，群发给学生；他们填学号姓名后会自动匹配并绑定。</p>
            ) : (
              <div className="space-y-2">
                {data.schoolTokens.map((t) => {
                  const url = `${origin}/bind/${t._id}`;
                  return (
                    <div key={t._id} className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs">
                      <code className="flex-1 break-all font-mono">{url}</code>
                      <Button
                        type="button" variant="ghost" size="sm" className="h-7 gap-1"
                        onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}); }}
                      >
                        <Copy className="size-3" />复制
                      </Button>
                      <span className="text-muted-foreground">
                        {t.expiresAt ? <>过期 <DateTime value={t.expiresAt} mode="date" /></> : '永久'}
                      </span>
                      <form method="post" action="/admin/userbind/tokens" className="inline-block">
                        <input type="hidden" name="operation" value="revoke" />
                        <input type="hidden" name="tokenId" value={t._id} />
                        <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">撤销</Button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
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
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <AdminPage
      title="班级 / 队伍（用户组）"
      description="学校下的学生分组 — 课程班级 / 校队 / 训练队等。"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={(
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={data.schools.length === 0}
          title={data.schools.length === 0 ? '请先创建学校' : undefined}
          className="gap-1"
        >
          <Plus className="size-3.5" />
          新建用户组
        </Button>
      )}
    >
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">名称</TableHead>
                <TableHead>所属学校</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.map((g) => (
                <TableRow key={g._id}>
                  <TableCell className="pl-5 font-medium">{g.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{schoolNameById.get(g.schoolId) || g.schoolId}</TableCell>
                  <TableCell>
                    <TableActions>
                      <TableAction href={`/admin/userbind/groups/${g._id}`}>查看</TableAction>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
              {data.groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    {data.schools.length === 0
                      ? '请先在「学校」页创建一个学校，再回来创建用户组。'
                      : '暂无用户组，点击右上角「新建用户组」开始创建。'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateGroupDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        schools={data.schools}
      />
    </AdminPage>
  );
}

function CreateGroupDialog({
  open, onClose, schools,
}: {
  open: boolean;
  onClose: () => void;
  schools: Array<{ _id: string; name: string }>;
}) {
  const [withRoster, setWithRoster] = useState(false);
  const [roster, setRoster] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[560px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>新建用户组</DialogTitle>
        </DialogHeader>
        <form method="post" className="flex flex-col">
          <ScrollArea className="h-[55vh]" viewportClassName="space-y-4 p-5">
            <input type="hidden" name="operation" value="create" />
            <FormRow columns={2}>
              <FormField label="所属学校" required htmlFor="group-school">
                <SimpleSelect
                  id="group-school"
                  name="schoolId"
                  required
                  defaultValue=""
                  placeholder="选择学校"
                  options={[
                    { value: '', label: '选择学校' },
                    ...schools.map((s) => ({ value: s._id, label: s.name })),
                  ]}
                />
              </FormField>
              <FormField label="用户组名称" required htmlFor="group-name">
                <Input id="group-name" name="name" placeholder="如 计网2025春-1班" required autoFocus />
              </FormField>
            </FormRow>
            <FormField label="同时导入成员名单（可选）">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={withRoster}
                    onChange={(e) => setWithRoster(e.target.checked)}
                   />
                  创建后立即导入一份成员名单
                </label>
                {withRoster && (
                  <textarea
                    name="initialRoster"
                    rows={6}
                    spellCheck={false}
                    value={roster}
                    onChange={(e) => setRoster(e.target.value)}
                    className="w-full rounded-md border bg-background p-3 font-mono text-sm"
                    placeholder={'每行 学号 姓名，已存在的学生会被加入此组；不存在的会先在所属学校建档。'}
                  />
                )}
              </div>
            </FormField>
          </ScrollArea>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit">创建用户组</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminUserbindGroupDetailPage() {
  const data = useBootstrap().page.data as {
    group: { _id: string; name: string };
    school: { _id: string; name: string } | null;
    members: Array<{
      _id: string;
      studentId: string;
      realName: string;
      boundUserId: number | null;
      boundUser?: { _id: number; uname?: string; studentId?: string; realName?: string } | null;
    }>;
    memberTotal?: number;
    page?: number;
    membersLimit?: number;
    unboundMemberCount?: number;
    groupTokens: Array<{ _id: string; createdAt: string; expiresAt: string | null }>;
    searchResults: Array<{ _id: string; studentId: string; realName: string; boundUserId: number | null }>;
    q: string;
    importReport: ImportResult | null;
    tab?: 'overview' | 'members' | 'add';
  };
  const memberTotal = data.memberTotal ?? data.members.length;
  const memberPage = data.page || 1;
  const memberLimit = data.membersLimit || 50;
  const memberPageCount = Math.max(1, Math.ceil(memberTotal / memberLimit));
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const activeTab = data.tab || 'overview';
  const groupHref = `/admin/userbind/groups/${data.group._id}`;
  return (
    <AdminPage title={`用户组 - ${data.group.name}`} description={data.school?.name} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <div className="flex flex-col gap-4">
        <MiniTabs
          value={activeTab}
          size="md"
          aria-label="用户组详情分页"
          items={[
            { value: 'overview', label: '总览', icon: LinkIcon, href: `${groupHref}?tab=overview` },
            { value: 'members', label: '人员', count: memberTotal, icon: Users, href: `${groupHref}?tab=members` },
            { value: 'add', label: '添加人员', icon: UserPlus, href: `${groupHref}?tab=add` },
          ]}
        />

        {activeTab === 'overview' && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <Card>
                <CardContent className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">成员</p>
                    <p className="mt-1 text-2xl font-semibold">{memberTotal}</p>
                  </div>
                  <Users className="size-5 text-muted-foreground" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">未绑定</p>
                    <p className="mt-1 text-2xl font-semibold">{data.unboundMemberCount || 0}</p>
                  </div>
                  <AlertCircle className="size-5 text-muted-foreground" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">邀请链接</p>
                    <p className="mt-1 text-2xl font-semibold">{(data.groupTokens || []).length}</p>
                  </div>
                  <LinkIcon className="size-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="px-5 pb-3 pt-5">
                <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                  <span className="flex items-center gap-2"><LinkIcon className="size-4" />用户组邀请链接</span>
                  <form method="post" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="operation" value="generateLink" />
                    <Input name="ttlDays" type="number" placeholder="有效天数（留空=永久）" className="w-[180px]" />
                    <Button type="submit" size="sm">生成新链接</Button>
                  </form>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                {(data.groupTokens || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">还没有该用户组的邀请链接。生成后可以发给学生自行加入并绑定。</p>
                ) : (
                  <div className="space-y-2">
                    {data.groupTokens.map((t) => {
                      const url = `${origin}/bind/${t._id}`;
                      return (
                        <div key={t._id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs">
                          <code className="min-w-0 flex-1 break-all font-mono">{url}</code>
                          <Button
                            type="button" variant="ghost" size="sm" className="h-7 gap-1"
                            onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}); }}
                          >
                            <Copy className="size-3" />复制
                          </Button>
                          <span className="text-muted-foreground">
                            {t.expiresAt ? <>过期 <DateTime value={t.expiresAt} mode="date" /></> : '永久'}
                          </span>
                          <form method="post" action="/admin/userbind/tokens" className="inline-block">
                            <input type="hidden" name="operation" value="revoke" />
                            <input type="hidden" name="tokenId" value={t._id} />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-destructive">撤销</Button>
                          </form>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === 'members' && (
          <>
            {data.importReport && <ImportResultPanel report={data.importReport} />}
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                  <span>成员 ({memberTotal})</span>
                  <form method="post">
                    <input type="hidden" name="operation" value="retryBind" />
                    <Button type="submit" variant="outline" size="sm" className="gap-1" disabled={(data.unboundMemberCount || 0) === 0}>
                      <RefreshCw className="size-3.5" />重新尝试绑定未绑定成员
                    </Button>
                  </form>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">学号</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>绑定用户</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.members.map((m) => {
                      const boundUser = m.boundUser;
                      const userMatches = boundUser
                        ? String(boundUser.studentId || '') === m.studentId && String(boundUser.realName || '') === m.realName
                        : false;
                      return (
                        <TableRow key={m._id}>
                          <TableCell className="pl-5 font-mono text-sm">{m.studentId}</TableCell>
                          <TableCell>{m.realName}</TableCell>
                          <TableCell>
                            {m.boundUserId ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                  <UserCheck className="mr-1 size-3" />已绑定
                                </Badge>
                                <a href={`/user/${m.boundUserId}`} className="font-mono text-xs hover:text-primary">
                                  UID {m.boundUserId}
                                </a>
                                {boundUser?.uname && <span className="text-xs text-muted-foreground">{boundUser.uname}</span>}
                                {boundUser && !userMatches && (
                                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                                    用户资料不一致
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">未绑定</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {data.members.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                          该组暂无成员。使用「添加人员」分页批量加入。
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
              {memberPageCount > 1 && (
                <div className="flex justify-center border-t px-5 py-3">
                  <Pagination
                    current={memberPage}
                    total={memberPageCount}
                    baseUrl={`${groupHref}?tab=members`}
                  />
                </div>
              )}
            </Card>
          </>
        )}

        {activeTab === 'add' && (
          <>
            <RosterImporter
              title="添加成员"
              description="名单导入会先在所属学校建档，再加入此组；搜索导入会从该学校已有学生中勾选。"
              action={groupHref}
              hiddenFields={{ operation: 'importText' }}
              enableSearch
              searchScope="school_roster"
              searchUrl={groupHref}
              searchHiddenFields={{ tab: 'add' }}
              searchResults={data.searchResults || []}
              searchQuery={data.q || ''}
              searchSelectFieldName="studentIds"
              submitLabel="加入用户组"
            />
            {data.importReport && <ImportResultPanel report={data.importReport} />}
          </>
        )}
      </div>
    </AdminPage>
  );
}

// ─── Admin: Students ──────────────────────────────────────────────────────

export function AdminUserbindStudentsPage() {
  const data = useBootstrap().page.data as {
    students: Array<{
      _id: string; studentId: string; realName: string;
      boundUserId: number | null; schoolId: string;
      enrollmentYear: number | null;
    }>;
    total: number; page: number; pageSize: number;
    schools: Array<{ _id: string; name: string }>;
    filterSchoolId: string | null;
    filterGroupId: string | null;
    q: string | null;
  };
  const page = data.page || 1;
  const pageSize = data.pageSize || 50;
  const pageCount = Math.max(1, Math.ceil((data.total || 0) / pageSize));
  const baseParams = new URLSearchParams();
  if (data.filterSchoolId) baseParams.set('schoolId', data.filterSchoolId);
  if (data.filterGroupId) baseParams.set('groupId', data.filterGroupId);
  if (data.q) baseParams.set('q', data.q);
  const paginationBaseUrl = `/admin/userbind/students${baseParams.toString() ? `?${baseParams}` : ''}`;
  return (
    <AdminPage title="学生记录" description={`共 ${data.total} 条`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent className="p-5">
          <form method="get" className="flex flex-wrap gap-3">
            <SimpleSelect
              name="schoolId"
              defaultValue={data.filterSchoolId || ''}
              className="w-auto min-w-[10rem]"
              options={[
                { value: '', label: '所有学校' },
                ...data.schools.map((s) => ({ value: s._id, label: s.name })),
              ]}
            />
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
                <TableHead className="w-32">入学年</TableHead>
                <TableHead className="w-40">绑定状态</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((s) => (
                <TableRow key={s._id}>
                  <TableCell className="pl-5 font-mono text-sm">{s.studentId}</TableCell>
                  <TableCell>{s.realName}</TableCell>
                  <TableCell>
                    {s.enrollmentYear ? (
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {s.enrollmentYear}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.boundUserId ? (
                      <Badge variant="secondary">已绑定 UID {s.boundUserId}</Badge>
                    ) : (
                      <Badge variant="outline">未绑定</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!s.boundUserId && (
                      <TableActions>
                        <TableAction
                          formAction=""
                          hidden={{ operation: 'generateStudentToken', studentRecordId: s._id }}
                          icon={KeyRound}
                        >单人令牌</TableAction>
                      </TableActions>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.students.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    {data.q ? `没有匹配「${data.q}」的学生` : '暂无学生记录。'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        {pageCount > 1 && (
          <div className="flex justify-center border-t px-5 py-3">
            <Pagination current={page} total={pageCount} baseUrl={paginationBaseUrl} />
          </div>
        )}
      </Card>
    </AdminPage>
  );
}

export function AdminUserbindStudentsImportPage() {
  const data = useBootstrap().page.data as {
    schools: Array<{ _id: string; name: string }>;
    groups: Array<{ _id: string; name: string; schoolId: string }>;
    report: ImportResult | null;
    preflightInvalid: Array<{ line: number; studentId: string; reason: string }> | null;
    targetKind: 'school' | 'user_group';
  };
  const [target, setTarget] = useState<'school' | 'user_group'>(data.targetKind || 'school');
  const [schoolId, setSchoolId] = useState('');
  const [groupId, setGroupId] = useState('');

  return (
    <AdminPage title="批量导入学生" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">导入格式与校验规则</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>每行一个学生，格式：<code className="rounded bg-muted px-1.5 py-0.5">学号 姓名</code>（空格 / 逗号 / 分号 / Tab 任意分隔）</li>
            <li>学号：1–64 位字母/数字/<code className="rounded bg-muted px-1.5 py-0.5">._-</code>，<strong>同一学校内不可重复</strong></li>
            <li>姓名：最多 32 字符，不可为空</li>
            <li>以 <code className="rounded bg-muted px-1.5 py-0.5">#</code> 开头的行会被忽略</li>
            <li>所有不合法行在提交前会高亮显示，不会被静默吞掉</li>
          </ul>
          <pre className="rounded-md border bg-muted/40 p-3 font-mono text-xs">
{`202301001 张三
202301002 李四
202301003 王五明
# 注释行会被忽略`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">选择导入目标</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={target === 'school' ? 'default' : 'outline'}
              onClick={() => setTarget('school')}
              size="sm"
              className="gap-1"
            >
              <Building2 className="size-4" />导入到学校
            </Button>
            <Button
              type="button"
              variant={target === 'user_group' ? 'default' : 'outline'}
              onClick={() => setTarget('user_group')}
              size="sm"
              className="gap-1"
            >
              <Users className="size-4" />导入到用户组
            </Button>
          </div>
          {target === 'school' && (
            <FormField label="目标学校" required htmlFor="imp-school">
              <SimpleSelect
                id="imp-school"
                value={schoolId}
                onValueChange={setSchoolId}
                className="max-w-md"
                placeholder="选择学校"
                options={[
                  { value: '', label: '选择学校' },
                  ...data.schools.map((s) => ({ value: s._id, label: s.name })),
                ]}
              />
            </FormField>
          )}
          {target === 'user_group' && (
            <FormField label="目标用户组" required htmlFor="imp-group" hint="不存在的学生会先在该组所属学校建档，再加入此组">
              <SimpleSelect
                id="imp-group"
                value={groupId}
                onValueChange={setGroupId}
                className="max-w-md"
                placeholder="选择用户组"
                options={[
                  { value: '', label: '选择用户组' },
                  ...data.groups.map((g) => ({ value: g._id, label: g.name })),
                ]}
              />
            </FormField>
          )}
        </CardContent>
      </Card>

      <RosterImporter
        title="名单导入"
        description="提交前可在下方预览每一行的校验状态。"
        action="/admin/userbind/students/import"
        hiddenFields={target === 'school'
          ? { targetKind: 'school', schoolId }
          : { targetKind: 'user_group', groupId }}
        submitLabel="开始导入"
      />

      {data.report && <ImportResultPanel report={{ ...data.report, preflightInvalid: data.preflightInvalid || [] }} />}
    </AdminPage>
  );
}

// ─── Admin: Tokens ────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  student: { label: '单人', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  school: { label: '学校共享', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  user_group: { label: '用户组共享', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-300' },
};

export function AdminUserbindTokensPage() {
  const data = useBootstrap().page.data as {
    tokens: Array<{
      _id: string; kind: string; createdAt: string; expiresAt: string | null;
      used: boolean; usedBy: number | null; targetLabel: string;
    }>;
    kind?: string;
    unusedOnly: boolean;
  };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <AdminPage title="邀请令牌" requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">类型:</span>
            <MiniTabs
              value={data.kind || 'all'}
              items={[
                { value: 'all', label: '全部', href: '/admin/userbind/tokens' },
                { value: 'school', label: '学校共享', href: '/admin/userbind/tokens?kind=school' },
                { value: 'user_group', label: '用户组共享', href: '/admin/userbind/tokens?kind=user_group' },
                { value: 'student', label: '单人', href: '/admin/userbind/tokens?kind=student' },
              ]}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">类型</TableHead>
                <TableHead>目标</TableHead>
                <TableHead>链接</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>过期时间</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tokens.map((t) => {
                const url = `${origin}/bind/${t._id}`;
                const kindInfo = KIND_LABELS[t.kind] || { label: t.kind, color: 'bg-muted text-muted-foreground' };
                return (
                  <TableRow key={t._id}>
                    <TableCell className="pl-5">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${kindInfo.color}`}>
                        {kindInfo.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{t.targetLabel}</TableCell>
                    <TableCell className="font-mono text-[10px]">
                      <button
                        type="button"
                        title={url}
                        onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}); }}
                        className="rounded px-1 py-0.5 hover:bg-accent"
                      >
                        <Copy className="inline size-3" /> 复制
                      </button>
                    </TableCell>
                    <TableCell>
                      {t.kind === 'student'
                        ? (t.used
                          ? <Badge variant="secondary">已使用 (UID {t.usedBy})</Badge>
                          : <Badge variant="outline">未使用</Badge>)
                        : <Badge variant="outline">共享中</Badge>}
                    </TableCell>
                    <TableCell className="text-xs"><DateTime value={t.createdAt} /></TableCell>
                    <TableCell className="text-xs">{t.expiresAt ? <DateTime value={t.expiresAt} /> : "永久"}</TableCell>
                    <TableCell>
                      <TableActions>
                        <TableAction
                          formAction=""
                          hidden={{ operation: 'revoke', tokenId: t._id }}
                          variant="destructive"
                        >撤销</TableAction>
                      </TableActions>
                    </TableCell>
                  </TableRow>
                );
              })}
              {data.tokens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    暂无邀请令牌。前往学校 / 用户组详情页生成共享链接，或在学生列表为单个学生发一次性令牌。
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
      schoolId: string;
      status: 'pending' | 'approved' | 'rejected'; createdAt: string;
      claimTempUserId: number | null; rejectReason: string | null;
      sourceTokenId: string | null; targetUserGroupId: string | null;
    }>;
    total: number; page: number; status?: string;
    schoolMap: Record<string, string>;
  };
  return (
    <AdminPage title="绑定申请" description={`共 ${data.total} 条`} requiredPriv={PRIV.PRIV_EDIT_SYSTEM}>
      <Card>
        <CardContent className="p-5">
          <MiniTabs
            size="md"
            value={data.status || 'all'}
            items={[
              { value: 'all', label: '全部', href: '/admin/userbind/requests' },
              { value: 'pending', label: '待审核', href: '/admin/userbind/requests?status=pending' },
              { value: 'approved', label: '已通过', href: '/admin/userbind/requests?status=approved' },
              { value: 'rejected', label: '已拒绝', href: '/admin/userbind/requests?status=rejected' },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">申请人</TableHead>
                <TableHead>学校</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>提交时间</TableHead>
                <TableHead className="w-44">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.requests.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="pl-5 font-mono text-xs">UID {r.userId}</TableCell>
                  <TableCell className="text-sm">{data.schoolMap[r.schoolId] || r.schoolId.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-sm">{r.studentIdInput}</TableCell>
                  <TableCell>{r.realNameInput}</TableCell>
                  <TableCell>
                    {r.claimTempUserId ? (
                      <Badge variant="outline" className="text-[10px]">认领临时账号 UID {r.claimTempUserId}</Badge>
                    ) : r.sourceTokenId ? (
                      <Badge variant="outline" className="text-[10px]">{r.targetUserGroupId ? '用户组链接' : '学校链接'}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">手动申请</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.status === 'pending' && <Badge>待审核</Badge>}
                    {r.status === 'approved' && <Badge variant="secondary">通过</Badge>}
                    {r.status === 'rejected' && (
                      <Badge variant="destructive" title={r.rejectReason || ''}>拒绝</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs"><DateTime value={r.createdAt} /></TableCell>
                  <TableCell>
                    {r.status === 'pending' && (
                      <TableActions>
                        <TableAction
                          formAction=""
                          hidden={{ operation: 'approve', requestId: r._id }}
                          variant="primary"
                        >通过</TableAction>
                        <form method="post" className="inline-block" onSubmit={(e) => {
                          const reason = window.prompt('驳回理由（必填）：') ?? '';
                          if (!reason.trim()) {
                            e.preventDefault();
                            alert('请填写驳回理由');
                            return;
                          }
                          const reasonInput = e.currentTarget.querySelector('input[name=reason]') as HTMLInputElement | null;
                          if (reasonInput) reasonInput.value = reason;
                        }}>
                          <input type="hidden" name="operation" value="reject" />
                          <input type="hidden" name="requestId" value={r._id} />
                          <input type="hidden" name="reason" value="" />
                          <button
                            type="submit"
                            className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-destructive/40 px-2.5 text-xs font-medium text-destructive transition-colors hover:border-destructive hover:bg-destructive/10"
                          >驳回</button>
                        </form>
                      </TableActions>
                    )}
                    {r.status === 'rejected' && r.rejectReason && (
                      <span className="text-xs text-muted-foreground" title={r.rejectReason}>
                        理由: {r.rejectReason.length > 20 ? r.rejectReason.slice(0, 20) + '…' : r.rejectReason}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
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
    alreadyBound: boolean;
    currentStudentId: string | null;
    currentRealName: string | null;
    hasPending: boolean;
  };

  if (data.alreadyBound) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader className="px-6 pb-3 pt-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-5 text-emerald-600" />
              身份已绑定
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-6 pb-6 text-sm">
            <p>你的账号已经绑定到学号 <span className="font-mono font-semibold">{data.currentStudentId}</span></p>
            <p>姓名：<span className="font-semibold">{data.currentRealName}</span></p>
            <p className="text-muted-foreground">绑定后无法修改。如需变更，请联系管理员。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">绑定学生身份</h1>
        <p className="text-sm text-muted-foreground">
          提交学号和姓名后，由管理员审核通过后完成绑定。
        </p>
      </div>
      {data.hasPending && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="size-4 shrink-0 text-amber-600" />
            <div className="flex-1 space-y-1 text-sm">
              <p className="font-medium">你已有待审核的申请</p>
              <p className="text-xs text-muted-foreground">
                请耐心等待管理员审核。你可以前往「<a href="/userbind/applications" className="underline">我的申请</a>」查看进度。
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-4">
            <FormField label="学校" required htmlFor="bind-school">
              <SimpleSelect
                id="bind-school"
                name="schoolId"
                required
                defaultValue=""
                placeholder="选择学校"
                options={[
                  { value: '', label: '选择学校' },
                  ...data.schools.map((s) => ({ value: s._id, label: s.name })),
                ]}
              />
            </FormField>
            <FormRow columns={2}>
              <FormField label="学号" required htmlFor="bind-studentId">
                <Input id="bind-studentId" name="studentId" required />
              </FormField>
              <FormField label="姓名" required htmlFor="bind-realName">
                <Input id="bind-realName" name="realName" required />
              </FormField>
            </FormRow>
            <div className="flex items-center justify-between gap-2">
              <a
                href="/userbind/applications"
                className="text-xs text-muted-foreground hover:underline"
              >
                查看我的申请记录 →
              </a>
              <Button type="submit">提交申请</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * /userbind/applications — student's full application history.
 */
export function UserBindApplicationsPage() {
  const data = useBootstrap().page.data as {
    requests: Array<{
      _id: string;
      studentIdInput: string;
      realNameInput: string;
      schoolId: string;
      status: 'pending' | 'approved' | 'rejected';
      createdAt: string;
      reviewedAt: string | null;
      rejectReason: string | null;
      sourceTokenId: string | null;
      targetUserGroupId: string | null;
      claimTempUserId: number | null;
    }>;
    schoolMap: Record<string, string>;
    groupMap: Record<string, string>;
    alreadyBound: boolean;
    currentStudentId: string | null;
    currentRealName: string | null;
  };
  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ListChecks className="size-5 text-primary" />
            我的申请
          </h1>
          <p className="text-sm text-muted-foreground">所有绑定申请的状态、审核结果和驳回理由都在这里。</p>
        </div>
        {!data.alreadyBound && (
          <Button asChild size="sm">
            <a href="/userbind">提交新申请</a>
          </Button>
        )}
      </header>

      {data.alreadyBound && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex items-start gap-3 p-5">
            <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
            <div className="flex-1 space-y-1 text-sm">
              <p className="font-medium">当前已绑定</p>
              <p className="text-muted-foreground">
                学号 <span className="font-mono">{data.currentStudentId}</span> · {data.currentRealName}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {data.requests.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <ListChecks className="mx-auto size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">你还没有提交过任何绑定申请。</p>
            {!data.alreadyBound && (
              <Button asChild>
                <a href="/userbind">现在去申请</a>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => {
            const schoolName = data.schoolMap[r.schoolId] || `学校 ID ${r.schoolId.slice(0, 8)}`;
            const groupName = r.targetUserGroupId ? (data.groupMap[r.targetUserGroupId] || '') : '';
            return (
              <Card key={r._id} className={r.status === 'rejected' ? 'border-rose-500/40' : undefined}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{r.studentIdInput}</span>
                        <span className="text-sm">{r.realNameInput}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {schoolName}
                        {groupName && ` · 加入用户组「${groupName}」`}
                        {r.claimTempUserId && ` · 认领临时账号 UID ${r.claimTempUserId}`}
                      </p>
                    </div>
                    <div>
                      {r.status === 'pending' && <Badge>待审核</Badge>}
                      {r.status === 'approved' && <Badge variant="secondary">已通过</Badge>}
                      {r.status === 'rejected' && <Badge variant="destructive">已驳回</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>提交：<DateTime value={r.createdAt} /></span>
                    {r.reviewedAt && <span>审核：<DateTime value={r.reviewedAt} /></span>}
                  </div>
                  {r.status === 'rejected' && r.rejectReason && (
                    <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
                      <p className="text-xs font-medium text-rose-700 dark:text-rose-300">驳回理由</p>
                      <p className="mt-0.5 text-sm">{r.rejectReason}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * /bind/:token — 3-kind landing page.
 */
export function UserBindLandingPage() {
  const data = useBootstrap().page.data as {
    token: string;
    signedIn: boolean;
    kind: 'student' | 'school' | 'user_group' | null;
    error?: string;
    errorMessage?: string;
    student?: { _id: string; studentId: string; realName: string; boundUserId: number | null } | null;
    school?: { _id: string; name: string } | null;
    group?: { _id: string; name: string } | null;
    groups?: Array<{ _id: string; name: string }>;
    inviter?: { uid: number; uname: string } | null;
    tokenInfo?: { createdAt: string; expiresAt: string | null; used?: boolean };
  };

  // Error cases
  if (data.error) {
    return (
      <div className="space-y-4">
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardHeader className="px-6 pb-3 pt-6">
            <CardTitle className="flex items-center gap-2 text-base text-rose-700 dark:text-rose-300">
              <AlertCircle className="size-5" />邀请链接不可用
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6">
            <p className="text-sm">{data.errorMessage}</p>
            <p className="text-xs text-muted-foreground">如有疑问请联系管理员重新发放邀请。</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const expiresLabel: ReactNode = data.tokenInfo?.expiresAt
    ? <DateTime value={data.tokenInfo.expiresAt} />
    : '永久';
  const createdLabel: ReactNode = data.tokenInfo?.createdAt
    ? <DateTime value={data.tokenInfo.createdAt} />
    : '';

  // Student kind: one-click bind
  if (data.kind === 'student' && data.student) {
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader className="px-6 pb-3 pt-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-5 text-primary" />学生身份绑定
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 px-6 pb-6">
            <FormSection title="学生信息">
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-4 text-sm">
                <KeyValueRow k="学号" v={data.student.studentId} mono />
                <KeyValueRow k="姓名" v={data.student.realName} />
                <KeyValueRow k="学校" v={data.school?.name || '—'} />
                {data.groups && data.groups.length > 0 && (
                  <div className="flex items-start gap-2 pt-1">
                    <span className="w-16 text-xs text-muted-foreground">用户组</span>
                    <div className="flex flex-wrap gap-1">
                      {data.groups.map((g) => (
                        <Badge key={g._id} variant="outline" className="text-[10px]">{g.name}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </FormSection>
            <FormSection title="邀请来源">
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-4 text-sm">
                <KeyValueRow k="邀请人" v={data.inviter ? `${data.inviter.uname} (UID ${data.inviter.uid})` : '系统'} />
                <KeyValueRow k="创建时间" v={createdLabel} />
                <KeyValueRow k="过期时间" v={expiresLabel} />
              </div>
            </FormSection>
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
              确认绑定后，你的账号将设置上述学号、姓名、学校和用户组。<strong>绑定后不可修改</strong>。如信息不符请联系管理员。
            </p>
            {data.signedIn ? (
              <form method="post">
                <Button type="submit" className="w-full">确认绑定</Button>
              </form>
            ) : (
              <Button asChild className="w-full">
                <a href={`/login?redirect=${encodeURIComponent(`/bind/${data.token}`)}`}>登录后绑定</a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // School / user_group: form-based
  const kindLabel = data.kind === 'school' ? '加入学校' : '加入用户组';
  const targetName = data.kind === 'school' ? data.school?.name : data.group?.name;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="px-6 pb-3 pt-6">
          <CardTitle className="flex items-center gap-2 text-base">
            {data.kind === 'school' ? <Building2 className="size-5 text-primary" /> : <Users className="size-5 text-primary" />}
            {kindLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 px-6 pb-6">
          <FormSection title="邀请详情">
            <div className="space-y-1.5 rounded-md border bg-muted/30 p-4 text-sm">
              <KeyValueRow k={data.kind === 'school' ? '学校' : '用户组'} v={targetName || '—'} />
              {data.kind === 'user_group' && (
                <KeyValueRow k="所属学校" v={data.school?.name || '—'} />
              )}
              <KeyValueRow k="邀请人" v={data.inviter ? `${data.inviter.uname} (UID ${data.inviter.uid})` : '系统'} />
              <KeyValueRow k="创建时间" v={createdLabel} />
              <KeyValueRow k="过期时间" v={expiresLabel} />
            </div>
          </FormSection>
          <FormSection title="验证你的身份" description="填写你的学号和姓名，系统会自动在该学校的学生名单中查找匹配。">
            {data.signedIn ? (
              <form method="post" className="space-y-3">
                <FormRow columns={2}>
                  <FormField label="学号" required htmlFor="land-sid">
                    <Input id="land-sid" name="studentId" required />
                  </FormField>
                  <FormField label="姓名" required htmlFor="land-name">
                    <Input id="land-name" name="realName" required />
                  </FormField>
                </FormRow>
                <Button type="submit" className="w-full">
                  {data.kind === 'school' ? '验证并加入学校' : '验证并加入用户组'}
                </Button>
              </form>
            ) : (
              <Button asChild className="w-full">
                <a href={`/login?redirect=${encodeURIComponent(`/bind/${data.token}`)}`}>登录后继续</a>
              </Button>
            )}
          </FormSection>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
            {data.kind === 'school'
              ? '若名单中找不到匹配学生，将自动转入"申请学生身份"流程，由管理员审核。'
              : '若名单中找不到匹配学生，将自动转入申请流程，审核通过后会一并加入此用户组。'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function KeyValueRow({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-muted-foreground">{k}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm'}>{v}</span>
    </div>
  );
}

export function UserBindSuccessPage() {
  const data = useBootstrap().page.data as {
    studentRecord: { studentId: string; realName: string };
    school: { name: string };
    joinedGroupId?: string | null;
    wasAlreadyBound?: boolean;
  };
  return (
    <div className="space-y-4">
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardHeader className="px-6 pb-3 pt-6">
          <CardTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-5" />
            {data.wasAlreadyBound ? '已加入' : '绑定成功'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-6 pb-6 text-sm">
          <p>学校：<span className="font-semibold">{data.school?.name}</span></p>
          <p>学号：<span className="font-mono">{data.studentRecord.studentId}</span></p>
          <p>姓名：<span className="font-semibold">{data.studentRecord.realName}</span></p>
          {data.joinedGroupId && (
            <p className="text-xs text-muted-foreground">已加入用户组。</p>
          )}
          <div className="pt-3">
            <Button asChild className="w-full">
              <a href="/">前往首页</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * /userbind/claim — 2-step temp account claim.
 */
export function UserBindClaimPage() {
  const data = useBootstrap().page.data as {
    step: 1 | 2;
    schools: Array<{ _id: string; name: string }>;
    schoolLocked: boolean;
    candidates: Array<{ uid: number; uname: string; createdAt: string; schoolId: string | null }> | null;
    studentIdInput?: string;
    realNameInput?: string;
    currentStudentId: string | null;
    currentRealName: string | null;
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Mail className="size-5 text-primary" />
          认领临时账号
        </h1>
        <p className="text-sm text-muted-foreground">
          如果你之前用临时账号参加过考试，可以在这里把那些考试记录归到你当前账号下。两步完成 — 不需要手动记 UID。
        </p>
      </header>

      {data.step === 1 && (
        <Card>
          <CardHeader className="px-6 pb-3 pt-6"><CardTitle className="text-base">第 1 步：填写学号 + 姓名</CardTitle></CardHeader>
          <CardContent className="px-6 pb-6">
            <form method="post" className="space-y-4">
              <input type="hidden" name="action" value="lookup" />
              <FormRow columns={2}>
                <FormField label="学号" required htmlFor="claim-sid">
                  <Input id="claim-sid" name="studentId" defaultValue={data.currentStudentId || ''} required />
                </FormField>
                <FormField label="姓名" required htmlFor="claim-name">
                  <Input id="claim-name" name="realName" defaultValue={data.currentRealName || ''} required />
                </FormField>
              </FormRow>
              <Button type="submit">查找匹配的临时账号</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {data.step === 2 && (
        <Card>
          <CardHeader className="px-6 pb-3 pt-6"><CardTitle className="text-base">第 2 步：选择要认领的临时账号</CardTitle></CardHeader>
          <CardContent className="px-6 pb-6">
            {(data.candidates || []).length === 0 ? (
              <div className="space-y-3">
                <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                  没有找到与「{data.studentIdInput} {data.realNameInput}」匹配的临时账号。请联系管理员协助。
                </p>
                <form method="post" className="inline-block">
                  <input type="hidden" name="action" value="lookup" />
                  <input type="hidden" name="studentId" value="" />
                  <input type="hidden" name="realName" value="" />
                  <Button type="submit" variant="outline" size="sm">重新搜索</Button>
                </form>
              </div>
            ) : (
              <form method="post" className="space-y-4">
                <input type="hidden" name="action" value="submit" />
                <input type="hidden" name="studentId" value={data.studentIdInput || ''} />
                <input type="hidden" name="realName" value={data.realNameInput || ''} />
                <FormField label="选择临时账号" required htmlFor="claim-temp-select" hint={`找到 ${data.candidates!.length} 个匹配账号`}>
                  <SimpleSelect
                    id="claim-temp-select"
                    name="tempUserId"
                    required
                    defaultValue=""
                    placeholder="请选择…"
                    options={[
                      { value: '', label: '请选择…' },
                      ...data.candidates!.map((c) => ({
                        value: String(c.uid),
                        label: `UID ${c.uid} · ${c.uname}`,
                      })),
                    ]}
                  />
                </FormField>
                <FormField label="学校" required htmlFor="claim-school-select" hint={data.schoolLocked ? '已根据你当前的学校锁定' : undefined}>
                  <SimpleSelect
                    id="claim-school-select"
                    name="schoolId"
                    required
                    disabled={data.schoolLocked}
                    defaultValue={data.schoolLocked ? (data.schools[0]?._id || '') : ''}
                    placeholder="请选择…"
                    options={[
                      ...(!data.schoolLocked ? [{ value: '', label: '请选择…' }] : []),
                      ...data.schools.map((s) => ({ value: s._id, label: s.name })),
                    ]}
                  />
                </FormField>
                <div className="flex gap-2">
                  <Button type="submit">提交认领申请</Button>
                  <form method="post" className="inline-block">
                    <input type="hidden" name="action" value="lookup" />
                    <input type="hidden" name="studentId" value="" />
                    <input type="hidden" name="realName" value="" />
                    <Button type="submit" variant="outline">重新搜索</Button>
                  </form>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
