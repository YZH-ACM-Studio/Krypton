/**
 * 老师自己的用户组。
 * 列表模板 teacher_user_groups.html，详情模板 teacher_user_group_detail.html。
 * 字段名与服务端 payload 一致；这里不做权限判断。
 */
import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';

const LIST_PATH = '/user-groups';
const REMOVE_FORM_ID = 'teacher-group-remove-members';
const SELECT_CLASS = 'h-(--control-md) w-full min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg shadow-xs hover:border-fg-disabled focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

interface TeacherGroupSchool {
  _id: string;
  name: string;
}

interface TeacherGroupListItem {
  _id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  archived: boolean;
  memberCount: number;
}

interface TeacherGroupListPayload {
  schools: TeacherGroupSchool[];
  groups: TeacherGroupListItem[];
  noScopeMessage: string | null;
}

interface TeacherGroupDetailGroup {
  _id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  archived: boolean;
}

interface TeacherGroupMember {
  _id: string;
  studentId: string;
  realName: string;
  bound: boolean;
  deletable: boolean;
}

interface TeacherGroupCandidate {
  _id: string;
  studentId: string;
  realName: string;
  bound: boolean;
}

interface TeacherGroupImportRow {
  studentId: string;
  reason: string;
}

interface TeacherGroupImportReport {
  created: number;
  attached: number;
  alreadyMember: number;
  autoBound: number;
  alreadyBound: number;
  failed: TeacherGroupImportRow[];
  autoBindSkipped: TeacherGroupImportRow[];
}

interface TeacherGroupDetailPayload {
  group: TeacherGroupDetailGroup;
  members: TeacherGroupMember[];
  candidates: TeacherGroupCandidate[];
  q: string;
  importReport: TeacherGroupImportReport | null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function readField(record: Record<string, unknown>, key: string, label: string): unknown {
  if (!Object.hasOwn(record, key)) throw new Error(`${label}缺少 ${key}`);
  return record[key];
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`);
  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return readString(value, label);
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}格式不正确`);
  return value;
}

function readCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${label}格式不正确`);
  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value;
}

function readSchool(value: unknown, index: number): TeacherGroupSchool {
  const label = `用户组列表 schools[${index}]`;
  const record = asRecord(value, label);
  return {
    _id: readString(readField(record, '_id', label), `${label} _id`),
    name: readString(readField(record, 'name', label), `${label} name`),
  };
}

function readListGroup(value: unknown, index: number): TeacherGroupListItem {
  const label = `用户组列表 groups[${index}]`;
  const record = asRecord(value, label);
  return {
    _id: readString(readField(record, '_id', label), `${label} _id`),
    name: readString(readField(record, 'name', label), `${label} name`),
    schoolId: readString(readField(record, 'schoolId', label), `${label} schoolId`),
    schoolName: readString(readField(record, 'schoolName', label), `${label} schoolName`),
    archived: readBoolean(readField(record, 'archived', label), `${label} archived`),
    memberCount: readCount(readField(record, 'memberCount', label), `${label} memberCount`),
  };
}

function readTeacherGroupListPayload(data: unknown): TeacherGroupListPayload {
  const record = asRecord(data, '用户组列表');
  return {
    schools: readArray(readField(record, 'schools', '用户组列表'), '用户组列表 schools').map(readSchool),
    groups: readArray(readField(record, 'groups', '用户组列表'), '用户组列表 groups').map(readListGroup),
    noScopeMessage: readNullableString(readField(record, 'noScopeMessage', '用户组列表'), '用户组列表 noScopeMessage'),
  };
}

function readDetailGroup(value: unknown): TeacherGroupDetailGroup {
  const label = '用户组详情 group';
  const record = asRecord(value, label);
  return {
    _id: readString(readField(record, '_id', label), `${label} _id`),
    name: readString(readField(record, 'name', label), `${label} name`),
    schoolId: readString(readField(record, 'schoolId', label), `${label} schoolId`),
    schoolName: readString(readField(record, 'schoolName', label), `${label} schoolName`),
    archived: readBoolean(readField(record, 'archived', label), `${label} archived`),
  };
}

function readMember(value: unknown, index: number): TeacherGroupMember {
  const label = `用户组详情 members[${index}]`;
  const record = asRecord(value, label);
  return {
    _id: readString(readField(record, '_id', label), `${label} _id`),
    studentId: readString(readField(record, 'studentId', label), `${label} studentId`),
    realName: readString(readField(record, 'realName', label), `${label} realName`),
    bound: readBoolean(readField(record, 'bound', label), `${label} bound`),
    deletable: readBoolean(readField(record, 'deletable', label), `${label} deletable`),
  };
}

function readCandidate(value: unknown, index: number): TeacherGroupCandidate {
  const label = `用户组详情 candidates[${index}]`;
  const record = asRecord(value, label);
  return {
    _id: readString(readField(record, '_id', label), `${label} _id`),
    studentId: readString(readField(record, 'studentId', label), `${label} studentId`),
    realName: readString(readField(record, 'realName', label), `${label} realName`),
    bound: readBoolean(readField(record, 'bound', label), `${label} bound`),
  };
}

function readImportRows(value: unknown, label: string): TeacherGroupImportRow[] {
  return readArray(value, label).map((item, index) => {
    const rowLabel = `${label}[${index}]`;
    const record = asRecord(item, rowLabel);
    return {
      studentId: readString(readField(record, 'studentId', rowLabel), `${rowLabel} studentId`),
      reason: readString(readField(record, 'reason', rowLabel), `${rowLabel} reason`),
    };
  });
}

function readImportReport(value: unknown): TeacherGroupImportReport | null {
  if (value === null) return null;
  const record = asRecord(value, '导入结果');
  return {
    created: readCount(readField(record, 'created', '导入结果'), '导入结果 created'),
    attached: readCount(readField(record, 'attached', '导入结果'), '导入结果 attached'),
    alreadyMember: readCount(readField(record, 'alreadyMember', '导入结果'), '导入结果 alreadyMember'),
    autoBound: readCount(readField(record, 'autoBound', '导入结果'), '导入结果 autoBound'),
    alreadyBound: readCount(readField(record, 'alreadyBound', '导入结果'), '导入结果 alreadyBound'),
    failed: readImportRows(readField(record, 'failed', '导入结果'), '导入结果 failed'),
    autoBindSkipped: readImportRows(readField(record, 'autoBindSkipped', '导入结果'), '导入结果 autoBindSkipped'),
  };
}

function readTeacherGroupDetailPayload(data: unknown): TeacherGroupDetailPayload {
  const record = asRecord(data, '用户组详情');
  return {
    group: readDetailGroup(readField(record, 'group', '用户组详情')),
    members: readArray(readField(record, 'members', '用户组详情'), '用户组详情 members').map(readMember),
    candidates: readArray(readField(record, 'candidates', '用户组详情'), '用户组详情 candidates').map(readCandidate),
    q: readString(readField(record, 'q', '用户组详情'), '用户组详情 q'),
    importReport: readImportReport(readField(record, 'importReport', '用户组详情')),
  };
}

function teacherGroupPath(groupId: string): string {
  return `${LIST_PATH}/${groupId}`;
}

function boundLabel(bound: boolean): string {
  return bound ? '已绑定' : '未绑定';
}

function archiveBadge(archived: boolean) {
  if (archived) return <Badge tone="neutral" variant="outline">已归档</Badge>;
  return <Badge tone="neutral">未归档</Badge>;
}

function ConfirmedPostForm({
  action,
  operation,
  fields = [],
  title,
  message,
  triggerLabel,
  confirmLabel,
  triggerVariant = 'danger-soft',
  size = 'md',
}: {
  action: string;
  operation: string;
  fields?: readonly { name: string; value: string }[];
  title: string;
  message: string;
  triggerLabel: string;
  confirmLabel: string;
  triggerVariant?: 'danger-soft' | 'secondary';
  size?: 'md' | 'sm';
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <form
        ref={formRef}
        method="post"
        action={action}
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <input type="hidden" name="operation" value={operation} />
        {fields.map((field) => (
          <input key={field.name} type="hidden" name={field.name} value={field.value} />
        ))}
        <Button type="submit" variant={triggerVariant} size={size}>
          {triggerLabel}
        </Button>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                const form = formRef.current;
                if (!form) throw new Error('确认提交时找不到表单');
                setOpen(false);
                form.submit();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportFailureTable({ label, rows }: { label: string; rows: readonly TeacherGroupImportRow[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-fg">{label}</h3>
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>学号</TableHead>
            <TableHead>原因</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="py-4 text-center text-sm text-fg-muted">
                无
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={`${index}:${row.studentId}:${row.reason}`}>
                <TableCell className="font-mono text-sm">{row.studentId}</TableCell>
                <TableCell>{row.reason}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function TeacherGroupImportReportView({ report }: { report: TeacherGroupImportReport }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-fg">导入结果</h3>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li className="tabular">新建 {report.created}</li>
        <li className="tabular">加入已有 {report.attached}</li>
        <li className="tabular">已是成员 {report.alreadyMember}</li>
        <li className="tabular">自动绑定 {report.autoBound}</li>
        <li className="tabular">已经绑定 {report.alreadyBound}</li>
      </ul>
      <ImportFailureTable label="导入失败" rows={report.failed} />
      <ImportFailureTable label="自动绑定跳过" rows={report.autoBindSkipped} />
    </div>
  );
}

function ArchiveGroupForm({ archived, action }: { archived: boolean; action: string }) {
  const operation = archived ? 'unarchive' : 'archive';
  const label = archived ? '取消归档' : '归档';
  return (
    <form method="post" action={action}>
      <input type="hidden" name="operation" value={operation} />
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

export function TeacherUserGroupsPage() {
  const data: unknown = useBootstrap().page.data;
  const payload = readTeacherGroupListPayload(data);
  if (payload.noScopeMessage !== null && payload.noScopeMessage.length > 0) {
    return (
      <Page width="wide">
        <p className="text-sm text-fg">{payload.noScopeMessage}</p>
      </Page>
    );
  }
  return (
    <Page width="wide">
      <PageHeader title="我的用户组" description="在你的学校范围内新建用户组，并维护组里的学生。" />
      <Panel title="新建用户组">
        <form method="post" action={LIST_PATH} className="space-y-5">
          <input type="hidden" name="operation" value="create" />
          <FormRow columns={2}>
            <FormField label="学校" htmlFor="teacher-group-school">
              {/* ds-allow DS005: SimpleSelect 不渲染原生 option，这张表单必须把 disabled 的「选择学校」和 name=schoolId 落在同一个 select 上。 */}
              <select id="teacher-group-school" name="schoolId" required defaultValue="" className={SELECT_CLASS}>
                <option value="" disabled>
                  选择学校
                </option>
                {payload.schools.map((school) => (
                  <option key={school._id} value={school._id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="用户组名称" htmlFor="teacher-group-name">
              <Input id="teacher-group-name" name="name" required placeholder="如 计网2025春-1班" />
            </FormField>
          </FormRow>
          <div className="flex justify-end">
            <Button type="submit" variant="primary">创建用户组</Button>
          </div>
        </form>
      </Panel>
      <Panel flush>
        <Table aria-label="我的用户组">
          <TableHeader>
            <TableRow>
              <TableHead>组名</TableHead>
              <TableHead>学校</TableHead>
              <TableHead>成员数</TableHead>
              <TableHead>是否已归档</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payload.groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-fg-muted">
                  还没有用户组。
                </TableCell>
              </TableRow>
            ) : (
              payload.groups.map((group) => (
                <TableRow key={group._id}>
                  <TableCell className="font-medium">
                    <a href={teacherGroupPath(group._id)} className="text-fg hover:text-brand-fg">
                      {group.name}
                    </a>
                  </TableCell>
                  <TableCell>{group.schoolName}</TableCell>
                  <TableCell className="tabular">{group.memberCount}</TableCell>
                  <TableCell>{archiveBadge(group.archived)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>
    </Page>
  );
}

export function TeacherUserGroupDetailPage() {
  const data: unknown = useBootstrap().page.data;
  const payload = readTeacherGroupDetailPayload(data);
  const action = teacherGroupPath(payload.group._id);
  return (
    <Page width="wide">
      <PageHeader
        title={payload.group.name}
        description={payload.group.schoolName}
        breadcrumb={(
          <a href={LIST_PATH} className="text-sm text-fg-muted hover:text-fg">
            返回我的用户组
          </a>
        )}
        meta={archiveBadge(payload.group.archived)}
      />

      <Panel title="基本信息">
        <div className="space-y-5">
          <form method="post" action={action} className="space-y-5">
            <input type="hidden" name="operation" value="rename" />
            <FormField label="用户组名称" htmlFor="teacher-group-rename">
              <Input id="teacher-group-rename" name="name" required defaultValue={payload.group.name} />
            </FormField>
            <Button type="submit" variant="secondary">
              保存名称
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <ArchiveGroupForm archived={payload.group.archived} action={action} />
            <ConfirmedPostForm
              action={action}
              operation="delete"
              title="删除用户组"
              message={`确认删除用户组「${payload.group.name}」？该操作无法恢复。`}
              triggerLabel="删除用户组"
              confirmLabel="确认删除用户组"
            />
          </div>
        </div>
      </Panel>

      <Panel
        title={`成员（${payload.members.length}）`}
        actions={(
          <ConfirmedPostForm
            action={action}
            operation="clearMembers"
            title="清空成员"
            message={`确认清空用户组「${payload.group.name}」的全部成员？学生记录不会被删除。`}
            triggerLabel="清空成员"
            confirmLabel="确认清空成员"
          />
        )}
      >
        <div className="space-y-4">
          <form id={REMOVE_FORM_ID} method="post" action={action}>
            <input type="hidden" name="operation" value="remove" />
            <Button type="submit" variant="secondary">
              移出选中成员
            </Button>
          </form>
          <Table aria-label="成员">
            <TableHeader>
              <TableRow>
                <TableHead>选择</TableHead>
                <TableHead>学号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>绑定</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payload.members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-fg-muted">
                    这个组还没有成员。
                  </TableCell>
                </TableRow>
              ) : (
                payload.members.map((member) => (
                  <TableRow key={member._id}>
                    <TableCell>
                      <Checkbox
                        size="sm"
                        name="studentRecordIds"
                        value={member._id}
                        form={REMOVE_FORM_ID}
                        aria-label={`移出 ${member.studentId} ${member.realName}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{member.studentId}</TableCell>
                    <TableCell>{member.realName}</TableCell>
                    <TableCell>{boundLabel(member.bound)}</TableCell>
                    <TableCell>
                      {member.deletable ? (
                        <ConfirmedPostForm
                          action={action}
                          operation="deleteStudent"
                          fields={[{ name: 'studentRecordId', value: member._id }]}
                          title="删除学生记录"
                          message={`确认删除学生记录「${member.studentId} ${member.realName}」？该操作无法恢复。`}
                          triggerLabel="删除这条记录"
                          confirmLabel="确认删除记录"
                          size="sm"
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Panel title="添加成员">
        <div className="space-y-5">
          <form method="get" action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <FormField label="搜索学生" htmlFor="teacher-group-member-query" className="min-w-0 flex-1">
              <Input id="teacher-group-member-query" name="q" defaultValue={payload.q} placeholder="学号或姓名" />
            </FormField>
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>
          <form method="post" action={action} className="space-y-4">
            <input type="hidden" name="operation" value="add" />
            {payload.candidates.length === 0 ? (
              <p className="text-sm text-fg-muted">没有可加入的学生。</p>
            ) : (
              <Table aria-label="可加入的学生">
                <TableHeader>
                  <TableRow>
                    <TableHead>选择</TableHead>
                    <TableHead>学号</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>绑定</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.candidates.map((candidate) => (
                    <TableRow key={candidate._id}>
                      <TableCell>
                        <Checkbox
                          size="sm"
                          name="studentRecordIds"
                          value={candidate._id}
                          aria-label={`加入 ${candidate.studentId} ${candidate.realName}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{candidate.studentId}</TableCell>
                      <TableCell>{candidate.realName}</TableCell>
                      <TableCell>{boundLabel(candidate.bound)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Button type="submit" variant="primary">加入选中学生</Button>
          </form>
        </div>
      </Panel>

      <Panel title="批量导入">
        <div className="space-y-5">
          <form method="post" action={action} className="space-y-5">
            <input type="hidden" name="operation" value="importText" />
            <FormField label="学号和姓名" htmlFor="teacher-group-import-text" hint="每行一条，学号和姓名用空格分开。">
              <Textarea
                id="teacher-group-import-text"
                name="text"
                rows={8}
                spellCheck={false}
                placeholder="20240001 张三"
                className="font-mono"
              />
            </FormField>
            <Button type="submit" variant="secondary">导入</Button>
          </form>
          {payload.importReport !== null ? <TeacherGroupImportReportView report={payload.importReport} /> : null}
        </div>
      </Panel>
    </Page>
  );
}
