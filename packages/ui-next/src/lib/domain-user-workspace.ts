export interface DomainUserSource {
  _id: string | number;
  uname?: string;
  displayName?: string;
  role?: string;
  join?: boolean;
}

export interface DomainUserRow {
  uid: string;
  uname: string;
  displayName: string;
  role: string;
  joined: boolean;
}

export function flattenDomainUsers(
  groupedUsers: Record<string, DomainUserSource[] | undefined>,
  roleOrder: string[] = Object.keys(groupedUsers),
): DomainUserRow[] {
  const ranks = new Map(roleOrder.map((role, index) => [role, index]));
  const seen = new Set<string>();
  const rows: DomainUserRow[] = [];

  for (const [groupRole, users] of Object.entries(groupedUsers)) {
    if (!Array.isArray(users)) throw new TypeError(`Domain user group "${groupRole}" must be an array`);
    for (const user of users) {
      const uid = String(user?._id ?? '');
      if (!uid) throw new TypeError(`Domain user in role "${groupRole}" is missing a UID`);
      if (seen.has(uid)) throw new TypeError(`Domain user UID ${uid} appears in more than one role`);
      seen.add(uid);
      rows.push({
        uid,
        uname: String(user.uname || ''),
        displayName: String(user.displayName || ''),
        role: String(user.role || groupRole),
        joined: user.join === true,
      });
    }
  }

  return rows.sort((a, b) => {
    const rankA = ranks.get(a.role) ?? Number.MAX_SAFE_INTEGER;
    const rankB = ranks.get(b.role) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    const nameOrder = (a.displayName || a.uname).localeCompare(b.displayName || b.uname, 'zh-CN');
    if (nameOrder !== 0) return nameOrder;
    return a.uid.localeCompare(b.uid, undefined, { numeric: true });
  });
}

export function filterDomainUsers(rows: DomainUserRow[], query: string, role: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (role && row.role !== role) return false;
    if (!normalized) return true;
    return [row.uid, row.uname, row.displayName].some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}

export function getSelectableDomainUserIds(rows: DomainUserRow[], ownerUid: string) {
  return rows.filter((row) => !ownerUid || row.uid !== ownerUid).map((row) => row.uid);
}

export function paginateDomainUsers<T>(items: T[], requestedPage: number, pageSize = 50) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError('pageSize must be a positive integer');
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedPage));
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    items: pageItems,
    page,
    pageSize,
    total: items.length,
    totalPages,
    start: items.length ? startIndex + 1 : 0,
    end: startIndex + pageItems.length,
  };
}
