import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { TEACHER_CAPABILITIES, type TeacherCapabilityKey } from '@hydrooj/common';
import { Plus, SearchX, Users } from 'lucide-react';
import { loadDomainUsers, type DomainUserOption } from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { resolveUiLocale } from '@/lib/format';
import { getJson, postForm } from '@/pages/teach/api';

const TEACHERS_PATH = '/admin/teachers';
const PAGE_DESCRIPTION = '域角色为「老师」的账号。设为老师后，侧栏出现「教学」分组；老师不需要绑定学生档案。';
const BINDING_WARNING = '普通账号要绑定学生档案才能继续用题目、比赛和作业（学生强制绑定）。';
const WRITE_FAILED = '教师管理写入失败，请重试。';
const RELOAD_FAILED = '教师名单刷新失败，请重试。';
const ROSTER_TAB = 'roster';
const CAPABILITY_TAB = 'capabilities';
const ALL_SCHOOLS = 'all';
const UNASSIGNED = 'unassigned';

type TeachersTab = typeof ROSTER_TAB | typeof CAPABILITY_TAB;
type SchoolFilter = typeof ALL_SCHOOLS | typeof UNASSIGNED | string;
type ConfirmVariant = 'primary' | 'danger';

interface OwnedCounts {
  courses: number;
  sets: number;
  groups: number;
}

interface SchoolRow {
  id: string;
  name: string;
}

interface TeacherRow {
  uid: number;
  uname: string;
  schoolIds: string[];
  schoolNames: string[];
  owned: OwnedCounts;
  loginAt: string | null;
}

interface CapabilityItem {
  key: TeacherCapabilityKey;
  enabled: boolean;
  defaultEnabled: boolean;
}

interface TeacherCapabilities {
  customized: boolean;
  stored: string | null;
  effective: string;
  items: CapabilityItem[];
}

interface AdminTeachersPayload {
  teachers: TeacherRow[];
  schools: SchoolRow[];
  capabilities: TeacherCapabilities;
}

type EnabledState = Record<TeacherCapabilityKey, boolean>;

interface CapabilityView {
  key: TeacherCapabilityKey;
  group: string;
  label: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
}

type ActiveDialog =
  | null
  | { kind: 'set' }
  | { kind: 'schools'; teacher: TeacherRow }
  | { kind: 'unset'; teacher: TeacherRow }
  | { kind: 'save' }
  | { kind: 'reset' };

function invalid(path: string): never {
  throw new TypeError(`admin teachers payload is invalid at ${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(path);
  return value;
}

function readCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(path);
  return value;
}

function readUid(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid(path);
  return value;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function readDecimal(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) invalid(path);
  return value;
}

function readLoginAt(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(path);
  return value;
}

function readOwned(value: unknown, path: string): OwnedCounts {
  if (!isRecord(value)) invalid(path);
  return {
    courses: readCount(value.courses, `${path}.courses`),
    sets: readCount(value.sets, `${path}.sets`),
    groups: readCount(value.groups, `${path}.groups`),
  };
}

function parseAdminTeachersPayload(raw: unknown): AdminTeachersPayload {
  if (!isRecord(raw)) invalid('payload');
  if (!Array.isArray(raw.schools)) invalid('schools');
  if (!Array.isArray(raw.teachers)) invalid('teachers');
  const schools: SchoolRow[] = [];
  const schoolNames = new Map<string, string>();
  raw.schools.forEach((entry, index) => {
    const path = `schools[${index}]`;
    if (!isRecord(entry)) invalid(path);
    const id = readText(entry.id, `${path}.id`);
    if (id === ALL_SCHOOLS || id === UNASSIGNED || schoolNames.has(id)) invalid(`${path}.id`);
    const name = readText(entry.name, `${path}.name`);
    schoolNames.set(id, name);
    schools.push({ id, name });
  });
  const seenUids = new Set<number>();
  const teachers = raw.teachers.map((entry, index) => {
    const path = `teachers[${index}]`;
    if (!isRecord(entry)) invalid(path);
    const uid = readUid(entry.uid, `${path}.uid`);
    if (seenUids.has(uid)) invalid(`${path}.uid`);
    seenUids.add(uid);
    if (!Array.isArray(entry.schoolIds)) invalid(`${path}.schoolIds`);
    const schoolIds: string[] = [];
    entry.schoolIds.forEach((schoolId, schoolIndex) => {
      const id = readText(schoolId, `${path}.schoolIds[${schoolIndex}]`);
      if (schoolIds.includes(id) || !schoolNames.has(id)) invalid(`${path}.schoolIds[${schoolIndex}]`);
      schoolIds.push(id);
    });
    return {
      uid,
      uname: readText(entry.uname, `${path}.uname`),
      schoolIds,
      schoolNames: schoolIds.map((id) => {
        const name = schoolNames.get(id);
        if (!name) invalid(`${path}.schoolIds`);
        return name;
      }),
      owned: readOwned(entry.owned, `${path}.owned`),
      loginAt: readLoginAt(entry.loginAt, `${path}.loginAt`),
    };
  });
  return {
    teachers,
    schools,
    capabilities: parseCapabilities(raw.capabilities),
  };
}

function parseCapabilities(raw: unknown): TeacherCapabilities {
  if (!isRecord(raw)) invalid('capabilities');
  const customized = readBoolean(raw.customized, 'capabilities.customized');
  const stored = raw.stored === null ? null : readDecimal(raw.stored, 'capabilities.stored');
  if (customized === (stored === null)) invalid('capabilities.stored');
  if (!Array.isArray(raw.items) || raw.items.length !== TEACHER_CAPABILITIES.length) invalid('capabilities.items');
  const items = raw.items.map((entry, index) => {
    const path = `capabilities.items[${index}]`;
    const spec = TEACHER_CAPABILITIES[index];
    if (!spec || !isRecord(entry) || entry.key !== spec.key) invalid(`${path}.key`);
    return {
      key: spec.key,
      enabled: readBoolean(entry.enabled, `${path}.enabled`),
      defaultEnabled: readBoolean(entry.defaultEnabled, `${path}.defaultEnabled`),
    };
  });
  return {
    customized,
    stored,
    effective: readDecimal(raw.effective, 'capabilities.effective'),
    items,
  };
}

function enabledState(items: readonly CapabilityItem[]): EnabledState {
  const state = {} as EnabledState;
  for (const item of items) state[item.key] = item.enabled;
  for (const spec of TEACHER_CAPABILITIES) {
    if (typeof state[spec.key] !== 'boolean') throw new TypeError(`missing capability ${spec.key}`);
  }
  return state;
}

function readEnabled(state: EnabledState, key: TeacherCapabilityKey): boolean {
  const value = state[key];
  if (typeof value !== 'boolean') throw new TypeError(`missing capability ${key}`);
  return value;
}

function capabilityViews(payload: AdminTeachersPayload, enabled: EnabledState): CapabilityView[] {
  return TEACHER_CAPABILITIES.map((spec, index) => {
    const item = payload.capabilities.items[index];
    if (!item || item.key !== spec.key) throw new TypeError('teacher capability list drifted');
    return {
      key: spec.key,
      group: spec.group,
      label: spec.label,
      description: spec.description,
      enabled: readEnabled(enabled, spec.key),
      defaultEnabled: item.defaultEnabled,
    };
  });
}

function groupCapabilities(views: readonly CapabilityView[]): Array<{ group: string; items: CapabilityView[] }> {
  const groups: Array<{ group: string; items: CapabilityView[] }> = [];
  for (const view of views) {
    const current = groups[groups.length - 1];
    if (current && current.group === view.group) current.items.push(view);
    else groups.push({ group: view.group, items: [view] });
  }
  return groups;
}

function capabilitiesDirty(items: readonly CapabilityItem[], enabled: EnabledState): boolean {
  return items.some((item) => readEnabled(enabled, item.key) !== item.enabled);
}

function enabledKeys(enabled: EnabledState): string[] {
  return TEACHER_CAPABILITIES.filter((spec) => readEnabled(enabled, spec.key)).map((spec) => spec.key);
}

function ownedLabel(owned: OwnedCounts): string {
  return `${owned.courses} 门课程 · ${owned.sets} 个题目集 · ${owned.groups} 个用户组`;
}

function removalLabel(names: readonly string[]): string {
  if (names.length === 0) throw new TypeError('staff removal requires a school');
  return `同时从「${names.join('、')}」的教职工名单移除`;
}

function avatarLetter(uname: string): string {
  const letter = Array.from(uname)[0];
  if (!letter) throw new TypeError('teacher uname is empty');
  return letter.toLocaleUpperCase('zh-CN');
}

function formatLoginAt(value: string | null, nowMs: number): string {
  if (value === null) return '从未登录';
  const at = Date.parse(value);
  if (!Number.isFinite(at)) throw new TypeError('loginAt is not a time');
  const diffMinutes = Math.round((at - nowMs) / 60000);
  const relative = new Intl.RelativeTimeFormat(resolveUiLocale(undefined), { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) return relative.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relative.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return relative.format(diffDays, 'day');
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return relative.format(diffMonths, 'month');
  return relative.format(Math.round(diffMonths / 12), 'year');
}

function readTeachersTab(): TeachersTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === null || tab === ROSTER_TAB) return ROSTER_TAB;
  if (tab === CAPABILITY_TAB) return CAPABILITY_TAB;
  throw new TypeError(`unknown admin teachers tab ${JSON.stringify(tab)}`);
}

function writeTeachersTab(tab: TeachersTab) {
  const url = new URL(window.location.href);
  if (tab === ROSTER_TAB) url.searchParams.delete('tab');
  else url.searchParams.set('tab', tab);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return WRITE_FAILED;
}

async function reloadTeachers(): Promise<AdminTeachersPayload> {
  return parseAdminTeachersPayload(await getJson(TEACHERS_PATH, RELOAD_FAILED));
}

function useTeacherWrite(onCommit: (next: AdminTeachersPayload, message: string) => void) {
  const form = useWriteForm();
  const accepted = useRef(false);
  function submit(write: () => Promise<void>, message: string) {
    void form.run(async () => {
      if (!accepted.current) {
        await write();
        accepted.current = true;
      }
      onCommit(await reloadTeachers(), message);
    });
  }
  return { ...form, submit };
}

function schoolsFor(schools: readonly SchoolRow[], ids: readonly string[]): SchoolRow[] {
  const byId = new Map(schools.map((school) => [school.id, school]));
  return ids.map((id) => {
    const school = byId.get(id);
    if (!school) throw new TypeError(`unknown school ${id}`);
    return school;
  });
}

function useAliveFlag() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

function useWriteForm() {
  const alive = useAliveFlag();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      if (alive.current) setError(messageOf(caught));
    } finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  }
  return { pending, error, setError, run };
}

function AdminPasswordField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <FormField label="管理员密码" htmlFor={id}>
      <Input
        id={id}
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

function AccountOption({ user }: { user: DomainUserOption }) {
  const uname = user.uname && user.uname.trim() !== '' ? user.uname : `UID ${user._id}`;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{uname}</span>
        <span className="shrink-0 font-mono text-2xs text-fg-subtle tabular">uid {user._id}</span>
      </span>
      {user.studentId ? <span className="text-2xs text-fg-subtle">已绑定学生 {user.studentId}</span> : null}
    </span>
  );
}

function SchoolPicker({
  schools,
  value,
  onChange,
}: {
  schools: readonly SchoolRow[];
  value: SchoolRow[];
  onChange: (next: SchoolRow[]) => void;
}) {
  return (
    <MultiSelect<SchoolRow>
      options={[...schools]}
      value={value}
      onChange={onChange}
      getKey={(school) => school.id}
      getLabel={(school) => school.name}
      placeholder="添加学校…"
      emptyText="没有匹配的学校"
    />
  );
}

function TeacherDialog({
  title,
  description,
  error,
  pending,
  confirmLabel,
  confirmVariant,
  cancelLabel,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  description?: string;
  error: string | null;
  pending: boolean;
  confirmLabel: string;
  confirmVariant: ConfirmVariant;
  cancelLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !pending) onClose(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            {children}
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{cancelLabel}</Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm} loading={pending}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetTeacherDialog({
  domainId,
  schools,
  onClose,
  onCommit,
}: {
  domainId: string;
  schools: readonly SchoolRow[];
  onClose: () => void;
  onCommit: (next: AdminTeachersPayload, message: string) => void;
}) {
  const passwordId = useId();
  const form = useTeacherWrite(onCommit);
  const [account, setAccount] = useState<DomainUserOption | null>(null);
  const [selected, setSelected] = useState<SchoolRow[]>([]);
  const [password, setPassword] = useState('');
  const submit = () => {
    if (!account) {
      form.setError('请先选择一个账号。');
      return;
    }
    if (password === '') {
      form.setError('请输入管理员密码。');
      return;
    }
    const uid = account._id;
    const schoolIds = selected.map((school) => school.id);
    form.submit(async () => {
      const body = new URLSearchParams();
      body.set('operation', 'set_teacher');
      body.set('uid', String(uid));
      body.set('schoolIds', schoolIds.join(','));
      body.set('password', password);
      await postForm(TEACHERS_PATH, body, WRITE_FAILED);
    }, '已把这个账号设为老师。');
  };
  return (
    <TeacherDialog
      title="设为老师"
      description="选一个账号，指定他任教的学校。"
      error={form.error}
      pending={form.pending}
      confirmLabel="设为老师"
      confirmVariant="primary"
      cancelLabel="取消"
      onClose={onClose}
      onConfirm={submit}
    >
      <FormField label="账号">
        <MultiSelect<DomainUserOption>
          loadOptions={async (query) => {
            try {
              return await loadDomainUsers(domainId, query);
            } catch (error) {
              form.setError(messageOf(error));
              return [];
            }
          }}
          value={account ? [account] : []}
          onChange={(next) => setAccount(next[0] ?? null)}
          getKey={(user) => String(user._id)}
          getLabel={(user) => user.uname ?? `UID ${user._id}`}
          renderOption={(user) => <AccountOption user={user} />}
          renderChip={(user) => user.uname ?? `UID ${user._id}`}
          maxItems={1}
          placeholder="搜索账号、UID 或学号"
          emptyText="没有匹配的账号"
        />
      </FormField>
      <FormField label="任教学校" hint="加进这些学校的教职工名单。可以先不选，之后在名单里改学校。">
        <SchoolPicker schools={schools} value={selected} onChange={setSelected} />
      </FormField>
      <AdminPasswordField id={passwordId} value={password} onChange={setPassword} />
    </TeacherDialog>
  );
}

function SchoolsDialog({
  teacher,
  schools,
  onClose,
  onCommit,
}: {
  teacher: TeacherRow;
  schools: readonly SchoolRow[];
  onClose: () => void;
  onCommit: (next: AdminTeachersPayload, message: string) => void;
}) {
  const passwordId = useId();
  const form = useTeacherWrite(onCommit);
  const [selected, setSelected] = useState(() => schoolsFor(schools, teacher.schoolIds));
  const [password, setPassword] = useState('');
  const submit = () => {
    if (password === '') {
      form.setError('请输入管理员密码。');
      return;
    }
    const schoolIds = selected.map((school) => school.id);
    form.submit(async () => {
      const body = new URLSearchParams();
      body.set('operation', 'set_schools');
      body.set('uid', String(teacher.uid));
      body.set('schoolIds', schoolIds.join(','));
      body.set('password', password);
      await postForm(TEACHERS_PATH, body, WRITE_FAILED);
    }, '已更新任教学校。');
  };
  return (
    <TeacherDialog
      title={`${teacher.uname} 任教的学校`}
      description="决定他能挂哪些学校的用户组、能从哪些学校选学生。"
      error={form.error}
      pending={form.pending}
      confirmLabel="保存"
      confirmVariant="primary"
      cancelLabel="取消"
      onClose={onClose}
      onConfirm={submit}
    >
      <FormField label="任教学校" hint="留空则这位老师没有任教学校。">
        <SchoolPicker schools={schools} value={selected} onChange={setSelected} />
      </FormField>
      <AdminPasswordField id={passwordId} value={password} onChange={setPassword} />
    </TeacherDialog>
  );
}

function UnsetTeacherDialog({
  teacher,
  onClose,
  onCommit,
}: {
  teacher: TeacherRow;
  onClose: () => void;
  onCommit: (next: AdminTeachersPayload, message: string) => void;
}) {
  const passwordId = useId();
  const form = useTeacherWrite(onCommit);
  const [removeStaff, setRemoveStaff] = useState(true);
  const [password, setPassword] = useState('');
  const hasSchools = teacher.schoolNames.length > 0;
  const submit = () => {
    if (password === '') {
      form.setError('请输入管理员密码。');
      return;
    }
    form.submit(async () => {
      const body = new URLSearchParams();
      body.set('operation', 'unset_teacher');
      body.set('uid', String(teacher.uid));
      body.set('removeStaff', hasSchools && removeStaff ? '1' : '0');
      body.set('password', password);
      await postForm(TEACHERS_PATH, body, WRITE_FAILED);
    }, '已取消老师身份。');
  };
  return (
    <TeacherDialog
      title={`取消 ${teacher.uname} 的老师身份？`}
      error={form.error}
      pending={form.pending}
      confirmLabel="取消老师"
      confirmVariant="danger"
      cancelLabel="保留"
      onClose={onClose}
      onConfirm={submit}
    >
      <p className="text-sm text-fg-muted">
        他会变回普通账号，侧栏不再有「教学」。他名下的 {teacher.owned.courses} 门课程 / {teacher.owned.sets} 个题目集 / {teacher.owned.groups} 个用户组保持不变。
      </p>
      <Alert tone="warning">{BINDING_WARNING}</Alert>
      {hasSchools ? (
        <Checkbox checked={removeStaff} onCheckedChange={setRemoveStaff} label={removalLabel(teacher.schoolNames)} />
      ) : null}
      <AdminPasswordField id={passwordId} value={password} onChange={setPassword} />
    </TeacherDialog>
  );
}

function PasswordActionDialog({
  title,
  description,
  confirmLabel,
  confirmVariant,
  successMessage,
  onClose,
  onCommit,
  onWrite,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: ConfirmVariant;
  successMessage: string;
  onClose: () => void;
  onCommit: (next: AdminTeachersPayload, message: string) => void;
  onWrite: (password: string) => Promise<void>;
}) {
  const passwordId = useId();
  const form = useTeacherWrite(onCommit);
  const [password, setPassword] = useState('');
  const submit = () => {
    if (password === '') {
      form.setError('请输入管理员密码。');
      return;
    }
    form.submit(() => onWrite(password), successMessage);
  };
  return (
    <TeacherDialog
      title={title}
      description={description}
      error={form.error}
      pending={form.pending}
      confirmLabel={confirmLabel}
      confirmVariant={confirmVariant}
      cancelLabel="取消"
      onClose={onClose}
      onConfirm={submit}
    >
      <AdminPasswordField id={passwordId} value={password} onChange={setPassword} />
    </TeacherDialog>
  );
}

function TeacherRoster({
  teachers,
  schools,
  now,
  onEditSchools,
  onUnset,
}: {
  teachers: readonly TeacherRow[];
  schools: readonly SchoolRow[];
  now: number;
  onEditSchools: (teacher: TeacherRow) => void;
  onUnset: (teacher: TeacherRow) => void;
}) {
  const [query, setQuery] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<SchoolFilter>(ALL_SCHOOLS);
  const filtering = query.trim() !== '' || schoolFilter !== ALL_SCHOOLS;
  const visible = teachers.filter((teacher) => {
    const needle = query.trim().toLowerCase();
    if (needle && !teacher.uname.toLowerCase().includes(needle)) return false;
    if (schoolFilter === UNASSIGNED) return teacher.schoolIds.length === 0;
    if (schoolFilter === ALL_SCHOOLS) return true;
    return teacher.schoolIds.includes(schoolFilter);
  });
  const columns: Column<TeacherRow>[] = [
    {
      key: 'account',
      header: '账号',
      cell: (teacher) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">{avatarLetter(teacher.uname)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{teacher.uname}</div>
            <div className="truncate text-xs text-fg-subtle tabular">uid {teacher.uid}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'schools',
      header: '任教学校',
      cell: (teacher) => (
        teacher.schoolNames.length === 0
          ? <span className="text-warning-fg">未指定学校</span>
          : <span className="min-w-0">{teacher.schoolNames.join('、')}</span>
      ),
    },
    {
      key: 'owned',
      header: '名下',
      cell: (teacher) => <span className="text-fg-muted tabular">{ownedLabel(teacher.owned)}</span>,
    },
    {
      key: 'login',
      header: '最近登录',
      cell: (teacher) => <span className="whitespace-nowrap text-fg-muted tabular">{formatLoginAt(teacher.loginAt, now)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (teacher) => (
        <TableActions align="end">
          <TableAction onClick={() => onEditSchools(teacher)}>改学校</TableAction>
          <TableAction variant="destructive" onClick={() => onUnset(teacher)}>取消老师</TableAction>
        </TableActions>
      ),
    },
  ];
  return (
    <>
      <Toolbar>
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索账号"
          aria-label="搜索账号"
          className="w-full sm:w-72"
        />
        <SimpleSelect
          ariaLabel="学校"
          className="w-44 shrink-0"
          value={schoolFilter}
          onValueChange={setSchoolFilter}
          options={[
            { value: ALL_SCHOOLS, label: '全部学校' },
            ...schools.map((school) => ({ value: school.id, label: school.name })),
            { value: UNASSIGNED, label: '未指定学校' },
          ]}
        />
      </Toolbar>
      <Panel flush>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(teacher) => String(teacher.uid)}
          mobile="scroll"
          empty={teachers.length === 0 ? (
            <EmptyState icon={<Users />} title="还没有老师。" description="点「设为老师」，把一个账号设为老师。" />
          ) : (
            <EmptyState
              compact
              icon={<SearchX />}
              title="没有匹配的老师。"
              description="换一个学校，或清除搜索。"
              action={filtering ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setSchoolFilter(ALL_SCHOOLS);
                  }}
                >
                  清除筛选
                </Button>
              ) : null}
            />
          )}
        />
      </Panel>
    </>
  );
}

function CapabilityPanel({
  payload,
  enabled,
  permissionUrl,
  onToggle,
  onSave,
  onReset,
}: {
  payload: AdminTeachersPayload;
  enabled: EnabledState;
  permissionUrl: string;
  onToggle: (key: TeacherCapabilityKey, next: boolean) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const views = capabilityViews(payload, enabled);
  const dirty = capabilitiesDirty(payload.capabilities.items, enabled);
  const stateText = payload.capabilities.customized ? '本域已自定义' : '使用系统默认';
  return (
    <>
      <Alert tone="info">
        这里的开关作用于全部老师，不能按人单独开关。当前{stateText}。其它细粒度权限在「
        <a href={permissionUrl} className="text-brand-fg underline-offset-4 hover:underline">权限管理</a>
        」里。
      </Alert>
      <div className="grid gap-4 xl:grid-cols-2">
        {groupCapabilities(views).map((group) => (
          <Panel key={group.group} title={group.group} flush>
            <div className="divide-y divide-line-subtle">
              {group.items.map((item) => (
                <div key={item.key} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{item.label}</span>
                      {item.enabled !== item.defaultEnabled ? <Badge tone="warning" size="sm">与默认不同</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">{item.description}</p>
                  </div>
                  <Switch
                    className="shrink-0"
                    checked={item.enabled}
                    aria-label={item.label}
                    onCheckedChange={(checked) => onToggle(item.key, checked)}
                  />
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" disabled={!payload.capabilities.customized} onClick={onReset}>恢复默认</Button>
        <Button type="button" variant="primary" disabled={!dirty} onClick={onSave}>保存</Button>
      </div>
    </>
  );
}

export function AdminTeachersPage() {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const domainId = bootstrap.domain.id;
  const permissionUrl = bootstrap.urls.domainPermission;
  if (domainId.trim() === '') throw new TypeError('admin teachers page is missing a domain id');
  if (permissionUrl.trim() === '') throw new TypeError('admin teachers page is missing the permission url');
  const [payload, setPayload] = useState(() => parseAdminTeachersPayload(bootstrap.page.data));
  const [enabled, setEnabled] = useState(() => enabledState(payload.capabilities.items));
  const [tab, setTab] = useState<TeachersTab>(() => readTeachersTab());
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const commit = (next: AdminTeachersPayload, message: string) => {
    setPayload(next);
    setEnabled(enabledState(next.capabilities.items));
    setDialog(null);
    toast.success(message);
  };
  const selectTab = (next: TeachersTab) => {
    writeTeachersTab(next);
    setTab(next);
  };
  return (
    <Page width="wide">
      <PageHeader
        title="教师"
        description={PAGE_DESCRIPTION}
        actions={(
          <Button type="button" variant={tab === ROSTER_TAB ? 'primary' : 'secondary'} onClick={() => setDialog({ kind: 'set' })}>
            <Plus aria-hidden="true" />
            设为老师
          </Button>
        )}
        tabs={(
          <PageTabs<TeachersTab>
            aria-label="教师管理"
            value={tab}
            onValueChange={selectTab}
            items={[
              { value: ROSTER_TAB, label: '教师名单', count: payload.teachers.length },
              { value: CAPABILITY_TAB, label: '老师能做什么' },
            ]}
          />
        )}
      />
      {tab === ROSTER_TAB ? (
        <TeacherRoster
          teachers={payload.teachers}
          schools={payload.schools}
          now={now}
          onEditSchools={(teacher) => setDialog({ kind: 'schools', teacher })}
          onUnset={(teacher) => setDialog({ kind: 'unset', teacher })}
        />
      ) : (
        <CapabilityPanel
          payload={payload}
          enabled={enabled}
          permissionUrl={permissionUrl}
          onToggle={(key, next) => setEnabled((current) => ({ ...current, [key]: next }))}
          onSave={() => setDialog({ kind: 'save' })}
          onReset={() => setDialog({ kind: 'reset' })}
        />
      )}
      {dialog?.kind === 'set' ? (
        <SetTeacherDialog domainId={domainId} schools={payload.schools} onClose={() => setDialog(null)} onCommit={commit} />
      ) : null}
      {dialog?.kind === 'schools' ? (
        <SchoolsDialog teacher={dialog.teacher} schools={payload.schools} onClose={() => setDialog(null)} onCommit={commit} />
      ) : null}
      {dialog?.kind === 'unset' ? (
        <UnsetTeacherDialog teacher={dialog.teacher} onClose={() => setDialog(null)} onCommit={commit} />
      ) : null}
      {dialog?.kind === 'save' ? (
        <PasswordActionDialog
          title="保存老师权限"
          description="保存后，这些开关作用于全部老师。"
          confirmLabel="保存"
          confirmVariant="primary"
          successMessage="已保存老师权限。"
          onClose={() => setDialog(null)}
          onCommit={commit}
          onWrite={async (password) => {
            const body = new URLSearchParams();
            body.set('operation', 'save_capabilities');
            body.set('enabled', enabledKeys(enabled).join(','));
            body.set('expected', payload.capabilities.effective);
            body.set('password', password);
            await postForm(TEACHERS_PATH, body, WRITE_FAILED);
          }}
        />
      ) : null}
      {dialog?.kind === 'reset' ? (
        <PasswordActionDialog
          title="恢复默认权限"
          description="删除本域保存的老师权限，回到系统默认。不会改任何账号的角色。"
          confirmLabel="恢复默认"
          confirmVariant="danger"
          successMessage="已恢复老师权限的系统默认。"
          onClose={() => setDialog(null)}
          onCommit={commit}
          onWrite={async (password) => {
            const stored = payload.capabilities.stored;
            if (stored === null) throw new TypeError('reset requires a stored teacher role');
            const body = new URLSearchParams();
            body.set('operation', 'reset_capabilities');
            body.set('expected', stored);
            body.set('password', password);
            await postForm(TEACHERS_PATH, body, WRITE_FAILED);
          }}
        />
      ) : null}
    </Page>
  );
}
