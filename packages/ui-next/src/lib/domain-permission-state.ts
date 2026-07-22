export interface DomainPermissionItem {
  key: string;
  name: string;
  detail: string;
  risk: 'high' | null;
  includes: Array<{ key: string; name: string }>;
}

export interface DomainPermissionFamily {
  key: string;
  label: string;
  permissions: DomainPermissionItem[];
}

export function parseDomainRoleMask(value: unknown, role: string): bigint {
  const raw = typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d+$/.test(raw)) throw new TypeError(`角色 ${role} 的权限掩码无效`);
  const mask = BigInt(raw);
  if (mask < 0n && role !== 'root') throw new TypeError(`角色 ${role} 的权限掩码不能为负数`);
  return mask;
}

export function flattenDomainPermissions(families: readonly DomainPermissionFamily[]): DomainPermissionItem[] {
  return families.flatMap((family) => family.permissions);
}

export function permissionKeysFromMask(mask: bigint, permissions: readonly DomainPermissionItem[]): Set<string> {
  if (mask < 0n) return new Set(permissions.map((permission) => permission.key));
  return new Set(permissions.filter((permission) => (mask & BigInt(permission.key)) !== 0n).map((permission) => permission.key));
}

export function composeDomainPermissionMask(
  expectedMask: bigint,
  selectedKeys: ReadonlySet<string>,
  permissions: readonly DomainPermissionItem[],
): bigint {
  if (expectedMask < 0n) throw new TypeError('只读 root 角色不能生成写入掩码');
  const knownMask = permissions.reduce((mask, permission) => mask | BigInt(permission.key), 0n);
  let selectedMask = 0n;
  for (const permission of permissions) if (selectedKeys.has(permission.key)) selectedMask |= BigInt(permission.key);
  return (expectedMask & ~knownMask) | selectedMask;
}

export function diffDomainPermissionDraft(
  original: ReadonlySet<string>,
  draft: ReadonlySet<string>,
  permissions: readonly DomainPermissionItem[],
) {
  return {
    added: permissions.filter((permission) => !original.has(permission.key) && draft.has(permission.key)),
    removed: permissions.filter((permission) => original.has(permission.key) && !draft.has(permission.key)),
  };
}

export function filterDomainPermissionFamilies(families: readonly DomainPermissionFamily[], query: string): DomainPermissionFamily[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  if (!needle) return families.map((family) => ({ ...family, permissions: [...family.permissions] }));
  return families
    .map((family) => {
      const familyMatch = `${family.label} ${family.key}`.toLocaleLowerCase('zh-CN').includes(needle);
      const permissions = familyMatch
        ? [...family.permissions]
        : family.permissions.filter((permission) =>
            `${permission.name} ${permission.detail}`.toLocaleLowerCase('zh-CN').includes(needle),
          );
      return { ...family, permissions };
    })
    .filter((family) => family.permissions.length > 0);
}

export function permissionIncluders(
  permissionKey: string,
  selectedKeys: ReadonlySet<string>,
  permissions: readonly DomainPermissionItem[],
): DomainPermissionItem[] {
  return permissions.filter(
    (permission) => selectedKeys.has(permission.key) && permission.includes.some((included) => included.key === permissionKey),
  );
}
