import { readHydroResponseError } from '@/lib/problem-save-response';

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
  const response = await fetch(`/d/${encodeURIComponent(domainId)}/api/users`, {
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
      <span className="truncate text-sm font-medium">
        {ojName}
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">UID {user._id}</span>
      </span>
      {studentIdentity || user.mail ? <span className="truncate text-[11px] text-muted-foreground">{studentIdentity || user.mail}</span> : null}
    </span>
  );
}
