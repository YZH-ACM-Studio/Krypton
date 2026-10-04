import { MultiSelect } from '@/components/ui/multi-select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

export interface DomainUserOption {
  _id: number;
  uname?: string;
  displayName?: string;
  mail?: string;
  avatarUrl?: string;
  studentId?: string;
  realName?: string;
}

export async function loadDomainUsers(domainId: string, query: string): Promise<DomainUserOption[]> {
  const search = query.trim();
  if (!search) return [];
  const response = await fetchHydroResponse(`/d/${encodeURIComponent(domainId)}/api/users`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args: { search, limit: 10, exact: false },
      projection: ['_id', 'uname', 'displayName', 'mail', 'avatarUrl', 'studentId', 'realName'],
    }),
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '用户搜索失败'));
  const users = await response.json();
  if (!Array.isArray(users) || users.some((item) => !Number.isSafeInteger(item?._id) || item._id <= 0)) {
    throw new Error('用户搜索响应格式错误');
  }
  return users;
}

function optionalUserText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function readDomainUser(value: unknown, invalidMessage: string): DomainUserOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalidMessage);
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record._id) || Number(record._id) <= 0) throw new Error(invalidMessage);
  const uname = optionalUserText(record.uname);
  const displayName = optionalUserText(record.displayName);
  const mail = optionalUserText(record.mail);
  const avatarUrl = optionalUserText(record.avatarUrl);
  const studentId = optionalUserText(record.studentId);
  const realName = optionalUserText(record.realName);
  return {
    _id: Number(record._id),
    ...(uname ? { uname } : {}),
    ...(displayName ? { displayName } : {}),
    ...(mail ? { mail } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(studentId ? { studentId } : {}),
    ...(realName ? { realName } : {}),
  };
}

export async function loadDomainUsersByIds(domainId: string, ids: number[]): Promise<DomainUserOption[]> {
  const unique = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!unique.length) return [];
  const response = await fetchHydroResponse(`/d/${encodeURIComponent(domainId)}/api/users`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      args: { ids: unique },
      projection: ['_id', 'uname', 'displayName', 'mail', 'avatarUrl', 'studentId', 'realName'],
    }),
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '用户资料加载失败'));
  const users = await response.json();
  if (!Array.isArray(users)) throw new Error('用户资料响应格式错误');
  return users.map((item) => readDomainUser(item, '用户资料响应格式错误'));
}

export function DomainUserMultiSelect({
  domainId,
  value,
  onChange,
  name,
  placeholder = '搜索 UID / OJ 用户 / 学号 / 姓名',
  emptyText = '没有匹配的用户',
  maxItems,
  minHeight,
  disabled,
}: {
  domainId: string;
  value: DomainUserOption[];
  onChange: (next: DomainUserOption[]) => void;
  name?: string;
  placeholder?: string;
  emptyText?: string;
  maxItems?: number;
  minHeight?: number;
  disabled?: boolean;
}) {
  return (
    <MultiSelect<DomainUserOption>
      value={value}
      onChange={onChange}
      loadOptions={(query) => loadDomainUsers(domainId, query)}
      getKey={(user) => String(user._id)}
      getLabel={domainUserSearchLabel}
      renderChip={(user) => (
        <span className="inline-flex max-w-full min-w-0 items-center gap-1">
          <span className="min-w-0 truncate">{user.displayName || user.uname || `UID ${user._id}`}</span>
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">#{user._id}</span>
        </span>
      )}
      renderOption={(user) => <DomainUserSearchOption user={user} />}
      name={name}
      placeholder={placeholder}
      emptyText={emptyText}
      maxItems={maxItems}
      {...(minHeight == null ? {} : { minHeight })}
      disabled={disabled}
    />
  );
}

export function domainUserSearchLabel(user: DomainUserOption) {
  return [user.displayName, user.uname || `uid:${user._id}`, user._id, user.mail, user.studentId, user.realName].filter(Boolean).join(' ');
}

export function DomainUserSearchOption({ user }: { user: DomainUserOption }) {
  const ojName =
    user.displayName && user.displayName !== user.uname
      ? `${user.displayName}（${user.uname || `UID ${user._id}`}）`
      : user.uname || `UID ${user._id}`;
  const studentIdentity = [user.studentId ? `学号 ${user.studentId}` : '', user.realName].filter(Boolean).join(' · ');
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{ojName}</span>
        <span className="shrink-0 font-mono text-2xs text-fg-subtle">UID {user._id}</span>
      </span>
      {studentIdentity || user.mail ? <span className="min-w-0 truncate text-2xs text-fg-subtle">{studentIdentity || user.mail}</span> : null}
    </span>
  );
}
