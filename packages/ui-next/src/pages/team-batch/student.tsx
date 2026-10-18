import { useCallback, useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Crown,
  LogOut,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { DomainUserSearchOption, type DomainUserOption, domainUserSearchLabel } from '@/components/domain-user-search';
import {
  TEAM_DIALOG_BUTTON_CLASS,
  TEAM_DIALOG_CONTROL_CLASS,
  TEAM_DIALOG_TEXTAREA_CLASS,
  TeamDialogBody,
  TeamDialogContent,
  TeamDialogField,
  TeamDialogFooter,
} from '@/components/team-dialog';
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { evaluateSelfTeamName } from '@/lib/contest-team-form';
import { formatDateTime } from '@/lib/format';
import { getJson } from '@/pages/teach/api';

const TEAM_SIZE = '1–3 人';
const NO_TEAM = '你还没有队伍。可以自己建队、接受别人的邀请，或者一个人成队。';
const OUT_OF_SCOPE = '你不在这次组队的范围内。';
const LOCKED = '组队已截止，阵容已锁定。';
const LOCK_NOTE = '截止后由老师统一锁定阵容，比赛里不能再换人。';
const STALE_HINT = '队伍已变化或已满';
const TEAM_CAPACITY = 3;

// jsdom does not implement the form entry iterator the submit listener reads.
function installFormEntries() {
  if (typeof HTMLFormElement === 'undefined') return;
  const prototype: object = HTMLFormElement.prototype;
  if ('entries' in prototype && typeof prototype.entries === 'function') return;
  Object.defineProperty(prototype, 'entries', {
    configurable: true,
    writable: true,
    value(this: HTMLFormElement) {
      return new FormData(this).entries();
    },
  });
}

installFormEntries();

interface Person {
  _id: number;
  uname: string;
  displayName: string;
  studentId?: string;
  realName?: string;
}

interface Capabilities {
  canManage: boolean;
  canCreate: boolean;
  canInvite: boolean;
  canEditOwn: boolean;
  canLeave: boolean;
}

interface OwnTeam {
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
}

interface PendingInvite {
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

interface DirectoryRow {
  teamId: string;
  name: string;
  captainUid: number;
  memberCount: number;
}

interface Directory {
  rows: DirectoryRow[];
  page: number;
  pageCount: number;
  total: number;
  search: string;
}

interface Batch {
  batchId: string;
  name: string;
  description: string;
  status: 'open' | 'closed';
  revision: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

interface StudentPageData {
  batch: Batch;
  ownTeam: OwnTeam | null;
  pendingInvites: PendingInvite[];
  users: Record<string, Person>;
  capabilities: Capabilities;
  directory: Directory;
  manageUrl: string | null;
}

interface ConfirmAction {
  title: string;
  description: string;
  operation: string;
  fields: Record<string, string | number>;
  confirmLabel: string;
  destructive?: boolean;
}

function invalid(path: string): never {
  throw new TypeError(`team_batch_student:${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path);
  return value;
}

function readRequiredText(value: unknown, path: string): string {
  const text = readString(value, path);
  if (!text.trim()) invalid(path);
  return text;
}

function readInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(path);
  return value;
}

function readUid(value: unknown, path: string): number {
  const uid = readInt(value, path);
  if (uid <= 0) invalid(path);
  return uid;
}

function readNonNegative(value: unknown, path: string): number {
  const parsed = readInt(value, path);
  if (parsed < 0) invalid(path);
  return parsed;
}

function readPositive(value: unknown, path: string): number {
  const parsed = readInt(value, path);
  if (parsed < 1) invalid(path);
  return parsed;
}

function readBool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path);
  return value;
}

function readUidList(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) invalid(path);
  return value.map((item, index) => readUid(item, `${path}[${index}]`));
}

function readNullableUid(value: unknown, path: string): number | null {
  if (value === null) return null;
  return readUid(value, path);
}

function readNullableInt(value: unknown, path: string): number | null {
  if (value === null) return null;
  return readInt(value, path);
}

function readOptionalString(source: Record<string, unknown>, key: string, path: string): string | undefined {
  if (!Object.hasOwn(source, key) || source[key] === undefined) return undefined;
  return readString(source[key], path);
}

function readStatus(value: unknown): 'open' | 'closed' {
  if (value === 'open' || value === 'closed') return value;
  return invalid('batch.status');
}

function readManagementMode(value: unknown, path: string): 'self' | 'admin' {
  if (value === 'self' || value === 'admin') return value;
  return invalid(path);
}

function readPerson(value: unknown, path: string): Person {
  if (!isRecord(value)) invalid(path);
  const studentId = readOptionalString(value, 'studentId', `${path}.studentId`);
  const realName = readOptionalString(value, 'realName', `${path}.realName`);
  return {
    _id: readUid(value._id, `${path}._id`),
    uname: readString(value.uname, `${path}.uname`),
    displayName: readString(value.displayName, `${path}.displayName`),
    ...(studentId === undefined ? {} : { studentId }),
    ...(realName === undefined ? {} : { realName }),
  };
}

function readUsers(value: unknown): Record<string, Person> {
  if (!isRecord(value)) invalid('users');
  const users: Record<string, Person> = {};
  for (const [key, item] of Object.entries(value)) {
    const person = readPerson(item, `users.${key}`);
    users[String(person._id)] = person;
  }
  return users;
}

function readOwnTeam(value: unknown): OwnTeam | null {
  if (value === null) return null;
  if (!isRecord(value)) invalid('ownTeam');
  return {
    teamId: readRequiredText(value.teamId, 'ownTeam.teamId'),
    name: readRequiredText(value.name, 'ownTeam.name'),
    description: readString(value.description, 'ownTeam.description'),
    captainUid: readUid(value.captainUid, 'ownTeam.captainUid'),
    memberUids: readUidList(value.memberUids, 'ownTeam.memberUids'),
    managementMode: readManagementMode(value.managementMode, 'ownTeam.managementMode'),
    revision: readNonNegative(value.revision, 'ownTeam.revision'),
    active: readBool(value.active, 'ownTeam.active'),
    createdAt: readRequiredText(value.createdAt, 'ownTeam.createdAt'),
    updatedAt: readRequiredText(value.updatedAt, 'ownTeam.updatedAt'),
  };
}

function readInvite(value: unknown, index: number): PendingInvite {
  const path = `pendingInvites[${index}]`;
  if (!isRecord(value)) invalid(path);
  return {
    inviteId: readRequiredText(value.inviteId, `${path}.inviteId`),
    teamId: readRequiredText(value.teamId, `${path}.teamId`),
    teamName: readRequiredText(value.teamName, `${path}.teamName`),
    inviterUid: readUid(value.inviterUid, `${path}.inviterUid`),
    teamRevision: readInt(value.teamRevision, `${path}.teamRevision`),
    currentRevision: readNullableInt(value.currentRevision, `${path}.currentRevision`),
    memberUids: readUidList(value.memberUids, `${path}.memberUids`),
    captainUid: readNullableUid(value.captainUid, `${path}.captainUid`),
    createdAt: readRequiredText(value.createdAt, `${path}.createdAt`),
    canAccept: readBool(value.canAccept, `${path}.canAccept`),
  };
}

function readDirectoryRow(value: unknown, index: number): DirectoryRow {
  const path = `directory.rows[${index}]`;
  if (!isRecord(value)) invalid(path);
  return {
    teamId: readRequiredText(value.teamId, `${path}.teamId`),
    name: readRequiredText(value.name, `${path}.name`),
    captainUid: readUid(value.captainUid, `${path}.captainUid`),
    memberCount: readNonNegative(value.memberCount, `${path}.memberCount`),
  };
}

function readDirectory(value: unknown): Directory {
  if (!isRecord(value)) invalid('directory');
  if (!Array.isArray(value.rows)) invalid('directory.rows');
  return {
    rows: value.rows.map((row, index) => readDirectoryRow(row, index)),
    page: readPositive(value.page, 'directory.page'),
    pageCount: readNonNegative(value.pageCount, 'directory.pageCount'),
    total: readNonNegative(value.total, 'directory.total'),
    search: readString(value.search, 'directory.search'),
  };
}

function readBatch(value: unknown): Batch {
  if (!isRecord(value)) invalid('batch');
  const closedAt = readOptionalString(value, 'closedAt', 'batch.closedAt');
  return {
    batchId: readRequiredText(value.batchId, 'batch.batchId'),
    name: readRequiredText(value.name, 'batch.name'),
    description: readString(value.description, 'batch.description'),
    status: readStatus(value.status),
    revision: readNonNegative(value.revision, 'batch.revision'),
    createdAt: readRequiredText(value.createdAt, 'batch.createdAt'),
    updatedAt: readRequiredText(value.updatedAt, 'batch.updatedAt'),
    ...(closedAt === undefined ? {} : { closedAt }),
  };
}

function readCapabilities(value: unknown): Capabilities {
  if (!isRecord(value)) invalid('capabilities');
  return {
    canManage: readBool(value.canManage, 'capabilities.canManage'),
    canCreate: readBool(value.canCreate, 'capabilities.canCreate'),
    canInvite: readBool(value.canInvite, 'capabilities.canInvite'),
    canEditOwn: readBool(value.canEditOwn, 'capabilities.canEditOwn'),
    canLeave: readBool(value.canLeave, 'capabilities.canLeave'),
  };
}

function readManageUrl(value: unknown): string | null {
  if (value === null) return null;
  return readRequiredText(value, 'manageUrl');
}

function parseTeamBatchStudentPage(raw: unknown): StudentPageData {
  if (!isRecord(raw)) invalid('page');
  if (!Array.isArray(raw.pendingInvites)) invalid('pendingInvites');
  return {
    batch: readBatch(raw.batch),
    ownTeam: readOwnTeam(raw.ownTeam),
    pendingInvites: raw.pendingInvites.map((item, index) => readInvite(item, index)),
    users: readUsers(raw.users),
    capabilities: readCapabilities(raw.capabilities),
    directory: readDirectory(raw.directory),
    manageUrl: readManageUrl(raw.manageUrl),
  };
}

function readSearchUsers(payload: unknown): DomainUserOption[] {
  if (!isRecord(payload) || !Array.isArray(payload.users)) invalid('search.users');
  return payload.users.map((item, index) => {
    const path = `search.users[${index}]`;
    if (!isRecord(item)) invalid(path);
    const studentId = readOptionalString(item, 'studentId', `${path}.studentId`);
    const realName = readOptionalString(item, 'realName', `${path}.realName`);
    const mail = readOptionalString(item, 'mail', `${path}.mail`);
    const uname = readOptionalString(item, 'uname', `${path}.uname`);
    const displayName = readOptionalString(item, 'displayName', `${path}.displayName`);
    return {
      _id: readUid(item._id, `${path}._id`),
      ...(uname === undefined ? {} : { uname }),
      ...(displayName === undefined ? {} : { displayName }),
      ...(studentId === undefined ? {} : { studentId }),
      ...(realName === undefined ? {} : { realName }),
      ...(mail === undefined ? {} : { mail }),
    };
  });
}

function userLabel(users: Record<string, Person>, uid: number): string {
  const user = users[String(uid)];
  if (!user) return `UID ${uid}`;
  if (user.displayName && user.displayName !== user.uname) return `${user.displayName}（${user.uname}）`;
  return user.uname || user.displayName || `UID ${uid}`;
}

function statusLabel(status: Batch['status']): string {
  return status === 'open' ? '进行中' : '已结束';
}

function statusTone(status: Batch['status']): BadgeTone {
  return status === 'open' ? 'success' : 'neutral';
}

function directoryBaseUrl(batchPath: string, search: string): string {
  if (!search) return batchPath;
  const params = new URLSearchParams();
  params.set('teamSearch', search);
  return `${batchPath}?${params.toString()}`;
}

function hiddenFields(fields: Record<string, string | number>) {
  return Object.entries(fields).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
}

function handleTeamNameSubmit(event: FormEvent<HTMLFormElement>, setNameError: (message: string) => void) {
  const nameInput = event.currentTarget.elements.namedItem('name');
  if (!(nameInput instanceof HTMLInputElement)) throw new Error('队伍名称输入框缺失');
  const nameValidation = evaluateSelfTeamName(nameInput.value);
  if (!nameValidation.preventSubmit) {
    setNameError('');
    return;
  }
  event.preventDefault();
  setNameError(nameValidation.error);
  nameInput.focus();
}

function ConfirmDialog({ action, onClose }: { action: ConfirmAction | null; onClose: () => void }) {
  return (
    <Dialog open={action !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <TeamDialogContent
        titleId="team-student-confirm-title"
        descriptionId="team-student-confirm-description"
        title={action?.title || '确认操作'}
        description={action?.description || '确认后会立即执行。'}
        icon={action?.destructive ? <AlertTriangle className="size-5" /> : <ShieldCheck className="size-5" />}
        tone={action?.destructive ? 'destructive' : 'primary'}
        onClose={onClose}
      >
        <form method="post" className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="operation" value={action?.operation || ''} />
          {hiddenFields(action?.fields || {})}
          <TeamDialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} className={TEAM_DIALOG_BUTTON_CLASS}>
              取消
            </Button>
            <Button type="submit" variant={action?.destructive ? 'danger' : 'primary'} className={TEAM_DIALOG_BUTTON_CLASS}>
              {action?.confirmLabel || '确认'}
            </Button>
          </TeamDialogFooter>
        </form>
      </TeamDialogContent>
    </Dialog>
  );
}

function TeamNameDialog({
  open,
  onClose,
  title,
  description,
  operation,
  fields,
  initialName,
  initialDescription,
  submitLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  operation: string;
  fields: Record<string, string | number>;
  initialName: string;
  initialDescription: string;
  submitLabel: string;
}) {
  const nameId = useId();
  const descriptionId = useId();
  const [nameError, setNameError] = useState('');
  const close = () => {
    setNameError('');
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <TeamDialogContent
        titleId={`${nameId}-title`}
        descriptionId={`${descriptionId}-title`}
        title={title}
        description={description}
        icon={<Crown className="size-5" />}
        onClose={close}
      >
        <form method="post" className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => handleTeamNameSubmit(event, setNameError)}>
          <input type="hidden" name="operation" value={operation} />
          {hiddenFields(fields)}
          <TeamDialogBody>
            <TeamDialogField htmlFor={nameId} label="队名" hint="1–64 个字符">
              <Input
                id={nameId}
                name="name"
                required
                maxLength={64}
                autoFocus
                defaultValue={initialName}
                invalid={nameError !== ''}
                aria-invalid={nameError !== '' || undefined}
                aria-describedby={nameError ? `${nameId}-error` : undefined}
                placeholder="给队伍起一个名字"
                onChange={() => { if (nameError) setNameError(''); }}
                className={TEAM_DIALOG_CONTROL_CLASS}
              />
              {nameError ? (
                <p id={`${nameId}-error`} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger-fg">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {nameError}
                </p>
              ) : null}
            </TeamDialogField>
            <TeamDialogField htmlFor={descriptionId} label="简介" hint="可选，最多 500 个字符">
              <Textarea
                id={descriptionId}
                name="description"
                maxLength={500}
                defaultValue={initialDescription}
                placeholder="训练方向、队伍介绍等"
                className={TEAM_DIALOG_TEXTAREA_CLASS}
              />
            </TeamDialogField>
          </TeamDialogBody>
          <TeamDialogFooter>
            <Button type="button" variant="secondary" onClick={close} className={TEAM_DIALOG_BUTTON_CLASS}>
              取消
            </Button>
            <Button type="submit" variant="primary" className={TEAM_DIALOG_BUTTON_CLASS}>
              {submitLabel}
            </Button>
          </TeamDialogFooter>
        </form>
      </TeamDialogContent>
    </Dialog>
  );
}

function MemberRoster({
  team,
  users,
  selfId,
  actions,
}: {
  team: OwnTeam;
  users: Record<string, Person>;
  selfId: number;
  actions: (uid: number) => ReactNode;
}) {
  return (
    <div className="divide-y divide-line-subtle">
      {team.memberUids.map((uid) => {
        const person = users[String(uid)];
        const name = userLabel(users, uid);
        const action = actions(uid);
        return (
          <div key={uid} className="flex min-w-0 flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="text-xs">{name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg">{name}</span>
                {team.captainUid === uid ? (
                  <Badge tone="neutral" size="sm">
                    <Crown className="size-3" />
                    队长
                  </Badge>
                ) : null}
                {uid === selfId ? <span className="shrink-0 text-sm text-fg-subtle">（你）</span> : null}
              </div>
              {person?.studentId ? (
                <p className="min-w-0 truncate text-xs text-fg-subtle">学号 {person.studentId}</p>
              ) : null}
            </div>
            {action ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{action}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function directoryColumns(users: Record<string, Person>): Column<DirectoryRow>[] {
  return [
    {
      key: 'name',
      header: '队名',
      stackRole: 'title',
      cell: (row) => <span className="block min-w-0 truncate font-medium">{row.name}</span>,
    },
    {
      key: 'captain',
      header: '队长',
      cell: (row) => <span className="block min-w-0 truncate text-fg-muted">{userLabel(users, row.captainUid)}</span>,
    },
    {
      key: 'count',
      header: '人数',
      align: 'right',
      cell: (row) => <span className="tabular">{row.memberCount} / {TEAM_CAPACITY}</span>,
    },
    {
      key: 'status',
      header: '状态',
      stackRole: 'meta',
      cell: (row) => (
        row.memberCount >= TEAM_CAPACITY
          ? <Badge tone="neutral">已满</Badge>
          : <Badge tone="success">{`缺 ${TEAM_CAPACITY - row.memberCount} 人`}</Badge>
      ),
    },
  ];
}

function SectionHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="border-b border-line-subtle px-4 py-2.5">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
    </div>
  );
}

function explanationItems(batch: Batch): { term: string; detail: string }[] {
  const items = [
    { term: '状态', detail: statusLabel(batch.status) },
    { term: '每队', detail: TEAM_SIZE },
  ];
  if (batch.description.trim()) items.push({ term: '说明', detail: batch.description });
  return items;
}

export function TeamBatchStudentPage() {
  const bs = useBootstrap();
  const data = parseTeamBatchStudentPage(bs.page.data);
  const batchPath = `/teams/${encodeURIComponent(data.batch.batchId)}`;
  const selfId = bs.user.id;
  const locked = data.batch.status === 'closed';
  const ownTeam = data.ownTeam;
  const isCaptain = ownTeam !== null && ownTeam.captainUid === selfId;
  const canRename = !locked && isCaptain && data.capabilities.canEditOwn;
  const canEditRoster = canRename && ownTeam?.managementMode === 'self';
  const canInvite = !locked && isCaptain && data.capabilities.canInvite;
  const canLeave = !locked && data.capabilities.canLeave;
  const mustTransferBeforeLeave = isCaptain && (ownTeam?.memberUids.length ?? 0) > 1;
  const canCreate = !locked && ownTeam === null && data.capabilities.canCreate;

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [inviteTargets, setInviteTargets] = useState<DomainUserOption[]>([]);
  const [inviteSearchError, setInviteSearchError] = useState<string | null>(null);

  const searchUsers = useCallback(async (query: string): Promise<DomainUserOption[]> => {
    const value = query.trim();
    if (!value) {
      setInviteSearchError(null);
      return [];
    }
    try {
      const payload = await getJson(`${batchPath}?search=${encodeURIComponent(value)}`, '队员搜索失败');
      const users = readSearchUsers(payload);
      setInviteSearchError(null);
      return users;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '队员搜索失败';
      setInviteSearchError(message);
      throw error;
    }
  }, [batchPath]);

  const askSolo = () => {
    setConfirmAction({
      title: '一个人成队？',
      description: '系统会立即创建由你担任队长的一人队。批次关闭前仍可以邀请最多两名队友。',
      operation: 'create_solo',
      fields: {},
      confirmLabel: '一个人成队',
    });
  };

  const askTransfer = (uid: number) => {
    if (!ownTeam) return;
    setConfirmAction({
      title: `把队长转让给 ${userLabel(data.users, uid)}？`,
      description: '转让后，对方立即获得队伍管理权；你仍是这支队伍的成员。',
      operation: 'transfer_captain',
      fields: { teamId: ownTeam.teamId, expectedRevision: ownTeam.revision, captainUid: uid },
      confirmLabel: '转让队长',
    });
  };

  const askRemove = (uid: number) => {
    if (!ownTeam) return;
    setConfirmAction({
      title: `移出 ${userLabel(data.users, uid)}？`,
      description: '该成员会立即退出这支队伍，并可以加入本批次的其它队伍。',
      operation: 'remove_member',
      fields: { teamId: ownTeam.teamId, expectedRevision: ownTeam.revision, memberUid: uid },
      confirmLabel: '移出',
      destructive: true,
    });
  };

  const askLeave = () => {
    if (!ownTeam || (ownTeam.captainUid === selfId && ownTeam.memberUids.length > 1)) return;
    setConfirmAction({
      title: '离开这支队伍？',
      description: ownTeam.memberUids.length === 1
        ? '最后一名成员离开后，队伍会停用。'
        : '离开后你会立即失去本批次的当前队伍身份。',
      operation: 'leave',
      fields: { teamId: ownTeam.teamId, expectedRevision: ownTeam.revision },
      confirmLabel: '离开队伍',
      destructive: true,
    });
  };

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={(
          <Breadcrumb items={[
            { label: '题目集', href: bs.urls.training },
            { label: data.batch.name },
          ]} />
        )}
        title={data.batch.name}
        meta={(
          <>
            <Badge tone="neutral">组队</Badge>
            <Badge tone={statusTone(data.batch.status)} dot>{statusLabel(data.batch.status)}</Badge>
            <span className="shrink-0">{`每队 ${TEAM_SIZE}`}</span>
          </>
        )}
        actions={data.manageUrl ? (
          <Button asChild variant="secondary">
            <a href={data.manageUrl}>管理批次</a>
          </Button>
        ) : undefined}
      />
      {/* ds-allow DS004: 详情页主栏加 20rem 侧栏，间距档写不出这条轨道 */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel flush>
            <SectionHeading title="我的队伍" />
            <div className="flex flex-col gap-4 p-4">
              {locked ? <p className="text-sm text-fg-muted text-pretty">{LOCKED}</p> : null}
              {!locked && ownTeam === null ? <p className="text-sm text-fg-muted text-pretty">{NO_TEAM}</p> : null}
              {!locked && ownTeam === null && !data.capabilities.canCreate ? (
                <p className="text-sm text-fg">{OUT_OF_SCOPE}</p>
              ) : null}
              {ownTeam ? (
                <div className="min-w-0">
                  <p className="break-words text-lg font-semibold text-fg text-balance">{ownTeam.name}</p>
                  <p className="mt-1 text-sm text-fg-muted tabular">{ownTeam.memberUids.length} / {TEAM_CAPACITY} 人</p>
                  {ownTeam.description ? <p className="mt-2 text-sm text-fg-muted text-pretty">{ownTeam.description}</p> : null}
                </div>
              ) : null}
              {ownTeam ? (
                <MemberRoster
                  team={ownTeam}
                  users={data.users}
                  selfId={selfId}
                  actions={(uid) => (
                    canEditRoster && uid !== selfId ? (
                      <>
                        <Button type="button" size="sm" variant="ghost" onClick={() => askRemove(uid)}>
                          移出
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => askTransfer(uid)}>
                          转让队长
                        </Button>
                      </>
                    ) : null
                  )}
                />
              ) : null}
              {canInvite ? (
                <form
                  method="post"
                  className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={(event) => {
                    if (inviteTargets.length !== 1) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="operation" value="invite" />
                  <MultiSelect<DomainUserOption>
                    className="min-w-0 flex-1"
                    value={inviteTargets}
                    onChange={setInviteTargets}
                    loadOptions={searchUsers}
                    getKey={(item) => String(item._id)}
                    getLabel={domainUserSearchLabel}
                    renderChip={(item) => <span className="min-w-0 truncate">{item.displayName || item.uname || `UID ${item._id}`}</span>}
                    renderOption={(item) => <DomainUserSearchOption user={item} />}
                    name="inviteeUid"
                    maxItems={1}
                    placeholder="输入学号或姓名邀请队员"
                    emptyText="没有可邀请的用户"
                  />
                  <Button type="submit" variant="secondary" className="shrink-0" disabled={inviteTargets.length !== 1}>
                    <UserPlus />
                    邀请
                  </Button>
                </form>
              ) : null}
              {inviteSearchError ? <Alert tone="danger">{inviteSearchError}</Alert> : null}
              {canCreate ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
                    <Plus />
                    创建队伍
                  </Button>
                  <Button type="button" variant="secondary" onClick={askSolo}>
                    <ShieldCheck />
                    一个人成队
                  </Button>
                </div>
              ) : null}
              {canRename || canLeave ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                  {canRename && ownTeam ? (
                    <Button type="button" variant="secondary" onClick={() => setRenameOpen(true)}>
                      <Pencil />
                      修改队名
                    </Button>
                  ) : null}
                  {canLeave ? (
                    <Button type="button" variant="danger-soft" disabled={mustTransferBeforeLeave} onClick={askLeave}>
                      <LogOut />
                      离开队伍
                    </Button>
                  ) : null}
                  {canLeave && mustTransferBeforeLeave ? (
                    <p className="min-w-0 text-xs text-fg-subtle">队长离开前要先转让队长。</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>

          {data.pendingInvites.length > 0 ? (
            <Panel flush>
              <SectionHeading title="收到的邀请" />
              <div className="divide-y divide-line-subtle px-4">
                {data.pendingInvites.map((invite) => (
                  <div key={invite.inviteId} className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="min-w-0 truncate font-medium text-fg">{invite.teamName}</p>
                      <p className="mt-1 min-w-0 truncate text-xs text-fg-subtle">
                        {invite.captainUid === null ? null : (
                          <span>
                            队长 <span>{userLabel(data.users, invite.captainUid)}</span>
                          </span>
                        )}
                        <span className="tabular"> {invite.memberUids.length} / {TEAM_CAPACITY}</span>
                        <span> · {formatDateTime(invite.createdAt, bs.locale)}</span>
                      </p>
                    </div>
                    {locked ? null : (
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                        <div className="flex flex-wrap gap-2">
                          <form method="post">
                            <input type="hidden" name="operation" value="decline_invite" />
                            <input type="hidden" name="inviteId" value={invite.inviteId} />
                            <Button type="submit" variant="secondary">拒绝</Button>
                          </form>
                          <form method="post">
                            <input type="hidden" name="operation" value="accept_invite" />
                            <input type="hidden" name="inviteId" value={invite.inviteId} />
                            <Button type="submit" variant="soft" disabled={!invite.canAccept}>接受</Button>
                          </form>
                        </div>
                        {invite.canAccept ? null : <p className="text-xs text-warning-fg">{STALE_HINT}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel flush>
            <SectionHeading title="全部队伍" description={<span className="tabular">{data.directory.total} 支队伍</span>} />
            <div className="border-b border-line-subtle px-4 py-3">
              <form method="get" action={batchPath} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  name="teamSearch"
                  defaultValue={data.directory.search}
                  placeholder="搜索队名"
                  maxLength={64}
                  leading={<Search />}
                  className="w-full sm:w-72"
                />
                <Button type="submit" variant="secondary" className="shrink-0">搜索</Button>
              </form>
            </div>
            <DataTable
              mobile="stack"
              columns={directoryColumns(data.users)}
              rows={data.directory.rows}
              rowKey={(row) => row.teamId}
              empty={(
                <EmptyState
                  compact
                  icon={<Users />}
                  title={data.directory.search ? '没有匹配的队伍' : '还没有队伍'}
                  description={data.directory.search ? '换一个队名继续搜索。' : '有人建队后会出现在这里。'}
                />
              )}
            />
            {data.directory.pageCount > 1 ? (
              <div className="border-t border-line-subtle px-4 py-2.5">
                <Pagination
                  current={data.directory.page}
                  total={data.directory.pageCount}
                  baseUrl={directoryBaseUrl(batchPath, data.directory.search)}
                  summary={<span className="tabular">共 {data.directory.total} 支</span>}
                />
              </div>
            ) : null}
          </Panel>
        </div>
        <aside className="min-w-0">
          <Panel flush>
            <SectionHeading title="组队说明" />
            <div className="p-4">
              <DescriptionList items={explanationItems(data.batch)} />
              <p className="mt-4 text-sm text-fg-subtle text-pretty">{LOCK_NOTE}</p>
            </div>
          </Panel>
        </aside>
      </div>

      <TeamNameDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建队伍"
        description="创建后你将成为队长，可以继续邀请至多两名队员。"
        operation="create_self"
        fields={{}}
        initialName=""
        initialDescription=""
        submitLabel="创建"
      />
      {ownTeam ? (
        <TeamNameDialog
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
          title="修改队名"
          description="保存后队员会看到新的队名和简介。"
          operation="update_info"
          fields={{ teamId: ownTeam.teamId, expectedRevision: ownTeam.revision }}
          initialName={ownTeam.name}
          initialDescription={ownTeam.description}
          submitLabel="保存"
        />
      ) : null}
      <ConfirmDialog action={confirmAction} onClose={() => setConfirmAction(null)} />
    </Page>
  );
}
